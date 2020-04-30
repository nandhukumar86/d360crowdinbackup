const Sequelize = require('sequelize');

const helper = require('../helpers');
const db = require('../db_connect');

//axios package
const axios = require('axios');

const catchRejection = helper.catchRejection;
const decryptData = helper.decryptData;
const nodeTypes = helper.nodeTypes;

let projectVersionId = ''
let d360Instance = ''

// Database structure Integration table
const Integration = db.define('integration', {
  uid: {
    type: Sequelize.STRING,
    allowNull: false,
    unique: true,
  },
  integrationToken: {
    type: Sequelize.STRING(10000),
  },
  integrationApiUrl: {
    type: Sequelize.STRING(10000),
  }
});

Integration.Login = () => (req, res) => {
  const url = req.body.url;
  const token = req.body.token;

  const { encryptData, decryptData, catchRejection, nodeTypes } = require('./../helpers');
  const integrationUid = `${res.origin.domain}__${res.origin.context.project_id}__${res.origin.sub}`;
  Integration.findOne({ where: { uid: integrationUid } })
    .then((integration) => {
      let params = {
        integrationToken: encryptData(token),
        integrationApiUrl: url,
      };
      if (integration) {
        return integration.update(params);
      } else {
        params.uid = integrationUid;
        return Integration.create(params);
      };

    })
    .then(() => res.status(204).send())
    .catch(catchRejection('Cant update token', res))
};

Integration.getApiClient = function (req, res) {

  return Integration.findOne({ where: { uid: res.clientId } })
    .then((integration) => {
      if (!integration) {
        // if we don't find Integration, we can't create Integration API client. Exit
        return res.status(404).send();
      }
      // initialize Integration API client and connect it to response object
      res.itntegrationCredentials = { url: integration.integrationApiUrl, token: decryptData(integration.integrationToken) }

      //instance initialization for axios
      d360Instance = axios.create({
        baseURL: integration.integrationApiUrl,
        headers: { 'Content-Type': 'application/json', 'api_token': decryptData(integration.integrationToken) }
      });

      return new Promise(resolve => resolve());
    })
};

// Get date from integration
Integration.getData = () => (req, resp) => {

  const mailChimpApi = resp.integrationClient; // Destruct integration client from response
  let files = [];

  // Define root elements for integration
  let roots = {
    'Project': 'data',
  };

  files.push(...Object.keys(roots).map(t => ({
    id: t,
    name: t,
    parent_id: 0,
    parent_name: t,
    node_type: nodeTypes.FOLDER,
  })));

  d360Instance.get('/ProjectVersions')
    .then(function (res) {
      projectVersionId = res.data.data[0].id
    }
    ).then(() => {
      Promise.all(Object.keys(roots).map(t =>
        d360Instance.get(`/ProjectVersions/${projectVersionId}/categories`)
      ))
        .then(function (res) {
          res.map(c => {
            c.data.data.forEach(item => {
              Recursion('category', item, 'Project', 'Project');
            });
          })
          resp.send(files);
        })
    })

  function Recursion(nodetype, obj, parentId, parentName) {

    if (nodetype == 'article') {
      obj["node_type"] = nodeTypes.FILE;
      obj["type"] = 'md';
      obj["name"] = obj.slug || (obj.settings || {}).title || obj.id;
      obj["fid"] = obj.name;
      obj["parent_id"] = parentId;
      obj["parent_name"] = parentName;
      files.push(obj);
    }

    if (nodetype == 'category') {

      obj["node_type"] = nodeTypes.FOLDER;
      obj["fid"] = obj.name;
      obj["parent_id"] = parentId;
      obj["parent_name"] = parentName;
      files.push(obj);

      var subCategories = obj.child_categories;
      var articles = obj.articles;

      subCategories.forEach(element => {
        Recursion('category', element, obj.id, obj.name);
      });

      articles.forEach(element => {
        Recursion('article', element, obj.id, obj.name);
      });
    }
  }
}
module.exports = Integration;