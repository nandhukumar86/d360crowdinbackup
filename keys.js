const isDev = (process.env.NODE_ENV || 'development') !== 'production';

const baseUrl = isDev
  ? "https://38fa33ab25db.ngrok.io"
  : "https://kovaid3603.herokuapp.com";

module.exports = {
  baseUrl: baseUrl,
  crowdinClientId: process.env.CROWDIN_CLIENT_ID || "6M8zDGaKumnuxbO3dJ9u",
  crowdinClientSecret: process.env.CROWDIN_CLIENT_SECRET || "BfHocTR480zCNeSfi76hoHa8YVONOlywPJtePeKR",
  integrationClientId: process.env.INTEGRATION_CLIENT_ID || "",
  integrationSecret: process.env.INTEGRATION_CLIENT_SECRET || "",
  callbackUrl: baseUrl + "/integration-token",
  cryptoSecret: process.env.CRYPTO_SECRET || 'UniqueCryptoSecret',
  crowdinAuthUrl : "https://accounts.crowdin.com/oauth/token"
};