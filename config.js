const keys = require('./keys');

const manifest = {
  "identifier": "document360-app-dev",
  "name": "Document360-dev",
  "baseUrl": keys.baseUrl,
  "authentication": {
      "type": "authorization_code",
      "clientId": keys.crowdinClientId,
  },
  "events": {
      "installed": "/installed"
  },
  "scopes": [
      "project"
  ],
  "modules": {
      "integrations": [
          {
              "key": "document360_app_test_dev",
              "name": "Document360-dev",
              "description": "Upload and localize your content from Document360",
              "logo": "/assets/logo.svg",
              "url": "/"
          }
      ]
  },
};

module.exports = manifest;