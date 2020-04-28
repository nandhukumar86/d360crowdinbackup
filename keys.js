const isDev = (process.env.NODE_ENV || 'development') !== 'production';

const baseUrl = isDev
  ? "https://e8c74db4.ngrok.io"
  : "https://d360app3.herokuapp.com";

module.exports = {
  baseUrl: baseUrl,
  crowdinClientId: process.env.CROWDIN_CLIENT_ID || "6M8zDGaKumnuxbO3dJ9u",
  crowdinClientSecret: process.env.CROWDIN_CLIENT_SECRET || "BfHocTR480zCNeSfi76hoHa8YVONOlywPJtePeKR",
  integrationClientId: process.env.INTEGRATION_CLIENT_ID || "776140467595",
  integrationSecret: process.env.INTEGRATION_CLIENT_SECRET || "ab847d4e5e756e2d7752cd647f06a66273a3a0ca79ab72d0a8",
  callbackUrl: baseUrl + "/integration-token",
  cryptoSecret: process.env.CRYPTO_SECRET || 'UniqueCryptoSecret',
  crowdinAuthUrl : "https://accounts.crowdin.com/oauth/token"
};