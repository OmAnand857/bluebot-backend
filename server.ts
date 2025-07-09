import express, { response, urlencoded } from "express";
import { Request , Response } from "express";
import dotenv from "dotenv";
import crypto from "crypto"
import axios from "axios";
import querystring from 'querystring';
import db from "./firestore";
import { isUserLoggedIn } from "./refresh";
import { isUserTweeting, startCronJob, stopCronJob } from "./cron";
const PORT = 3000 ;
const app = express();
app.use(express.urlencoded({ extended: true })); // for form-encoded
app.use(express.json());                         // for JSON

dotenv.config();

const OAUTH_CALLBACK = "bluebot://callback"
const consumerKey = process.env.CONSUMER_KEY;
const consumerSecret = process.env.CONSUMER_SECRET;
const clientId = process.env.CLIENT_ID;
// const clientSecret = process.env.CLIENT_SECRET;

function buildOAuthHeader(params: Record<string, string>) {
  const headerParams = Object.entries(params)
    .map(([key, val]) => `${encodeURIComponent(key)}="${encodeURIComponent(val)}"`)
    .join(', ');

  return `OAuth ${headerParams}`;
}

// let tokenStore: Map<string, Record<string , any > > = new Map();
let codeVerifierMap : Map < string , string >  = new Map() ;


app.get('/loginIntent' , async ( req : Request , res : Response ) => {
    
    if( consumerKey==undefined || consumerSecret==undefined ) return ;

    const resourceUrl = "https://api.x.com/oauth/request_token";
    const nonce = crypto.randomBytes(16).toString("base64").replace(/[^a-zA-Z0-9]/g, "");

    const parameters : Record< string , string >  = {
        oauth_consumer_key : consumerKey,
        oauth_callback : OAUTH_CALLBACK ,
        oauth_nonce : nonce ,
        oauth_timestamp : Math.floor(Date.now() / 1000).toString(),
        oauth_version : "1.0",
        oauth_signature_method : "HMAC-SHA1",
    }

    //https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature
    // percent encoding every key value pair of parameters to get parameter string

    let listOfEncodedKeyValuePair : Array<Array<string>> = [];

    for( const [ key , value ] of Object.entries(parameters) ){
        const encodedKey = encodeURIComponent( key );
        const encodedValue = encodeURIComponent( value );
        listOfEncodedKeyValuePair.push( [encodedKey , encodedValue ] );
    }

    listOfEncodedKeyValuePair.sort( ( a , b ) => a[0].localeCompare(b[0]) );

    let parameterString = "";
    for( const [ i , keyVal ] of listOfEncodedKeyValuePair.entries() ){
        parameterString+=keyVal[0];
        parameterString+='=';
        parameterString+=keyVal[1];
        if( i!=listOfEncodedKeyValuePair.length-1 ) parameterString+='&';
    }

    const resourceStringEncoded = encodeURIComponent(resourceUrl);

    let outputString = "POST&";

    outputString+=resourceStringEncoded;
    outputString+='&';
    outputString+=encodeURIComponent(parameterString);

    // at this point we have a signature base string which is outputstring

    const signingKey = encodeURIComponent(consumerSecret) + '&';

    const signature = crypto.createHmac("sha1" , signingKey).update(outputString).digest("base64");
    
    const headerPrameters : Record< string , string > = {};

    for( const [ key , value ] of Object.entries(parameters) ){
        headerPrameters[key] = value ;
    }
    headerPrameters["oauth_signature"] = signature ;

    try {
        const response = await axios.post(resourceUrl, null, {
            headers: {
                Authorization: buildOAuthHeader(headerPrameters),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        const parsed = querystring.parse(response.data);
        res.status(200).send(parsed.oauth_token);
    }
    catch (err) {
        res.status(400).send("Failed to get request token");
    }
})


app.post('/completeOauth1', async (req: Request, res: Response) => {
  const { oauth_token, oauth_verifier, user_name } = req.body;
  const resourceUrl = "https://api.x.com/oauth/access_token";

  try {
    const params = new URLSearchParams();
    params.append('oauth_token', oauth_token);
    params.append('oauth_verifier', oauth_verifier);

    const response = await axios.post(resourceUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const parsed = querystring.parse(response.data);
    const oauth_token_db = parsed.oauth_token;
    const oauth_token_secret_db = parsed.oauth_token_secret;
    await db.collection("users").doc(user_name).set({
      oauth_token: oauth_token_db,
      oauth_token_secret: oauth_token_secret_db
    }, { merge: true });
    res.status(200).send("success");
  } catch (e) {
    res.redirect(`bluebot://callback?auth1=error`);
  }
});


app.get("/loginIntentOauth2",( req : Request , res : Response )=>{
    if( clientId==undefined ) return res.status(500).send("Internal server error");
    // const baseUrl = "https://x.com/i/oauth2/authorize";
    const user_name = req.query.user_name as string;
    if (!user_name) return res.status(400).send("Missing user_name");
    function base64URLEncode(buffer: Buffer): string {
        return buffer
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    function sha256(buffer: string): Buffer {
        return crypto.createHash('sha256').update(buffer).digest();
    }
    const min = 43;
    const max = 128;
    const randomLength = Math.floor(Math.random() * (max - min + 1)) + min;

    const code_verifier = base64URLEncode(crypto.randomBytes(randomLength));
    const code_challenge = base64URLEncode(sha256(code_verifier));
    
    
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId.toString(),
        redirect_uri: OAUTH_CALLBACK,
        scope: 'tweet.read tweet.write media.write users.read offline.access follows.read',
        state: crypto.randomBytes(16).toString("base64").replace(/[^a-zA-Z0-9]/g, ""),
        code_challenge: code_challenge,
        code_challenge_method: 'S256'
    });
    codeVerifierMap.set( user_name , code_verifier );
    const authUrl = `https://x.com/i/oauth2/authorize?${params.toString()}`;
    res.status(200).send(authUrl);
})


app.post("/completeOauth2", async (req: Request, res: Response) => {
  if (!clientId) return res.status(500).send("Internal server error");

  const { state, code, user_name } = req.body;
  if (!user_name || !codeVerifierMap.has(user_name)) {
    return res.redirect("bluebot://callback?auth2=error");
  }

  const baseUrl = "https://api.x.com/2/oauth2/token";
  const code_verifier = codeVerifierMap.get(user_name)!;

  const requestData = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: OAUTH_CALLBACK,
    code_verifier
  });

  try {
    const response = await axios.post(baseUrl, requestData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    });

    const responseData = response.data;
    const access_token = responseData.access_token;
    const refresh_token = responseData.refresh_token;
    const expires_in = responseData.expires_in;
    const expires_at = Date.now() + expires_in * 1000;

    await db.collection("users").doc(user_name).set({
      access_token,
      refresh_token,
      expires_at
    }, { merge: true });
    res.status(200).send("success");
  } catch (e) {
    res.redirect(`bluebot://callback?auth2=error`);
  }
});



app.get("/isUserLoggedIn", async (req: Request, res: Response) => {
        if( !clientId ) return res.status(500).send("Internal Server Error");
        const user_name = req.query.user_name as string;
        if( user_name==undefined ){
            return res.status(400).send("send username");
        }
        try{
            const result : boolean = await isUserLoggedIn( user_name , clientId );
            res.status(200).send(result.toString());
        }
        catch(e){
            res.status(500).send("Internal server error");
        }
});

app.get("/startTweeting",(req : Request , res : Response)=>{
    const user_name = req.query.user_name as string;
    if( user_name==undefined ){
        return res.status(400).send("send username");
    }
    startCronJob(user_name);
    res.status(200).send("started");
});

app.get("/stopTweeting" , ( req : Request , res : Response )=>{
    const user_name = req.query.user_name as string ;
        if( user_name==undefined ){
        return res.status(400).send("send username");
    }
    stopCronJob(user_name);
    res.status(200).send("stopped");
})

app.get("/isUserTweeting",( req : Request , res : Response )=>{
     const user_name = req.query.user_name as string ;
        if( user_name==undefined ){
        return res.status(400).send("send username");
    }
    res.status(200).send( isUserTweeting(user_name).toString() );
})


app.get('/ping', (req, res) => {
  res.send('pong');
});

app.listen( PORT , ()=>{
    console.log("Your server is running on port 3000");
})




