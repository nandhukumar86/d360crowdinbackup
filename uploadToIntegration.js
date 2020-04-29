const axios = require('axios').default;

const helper = require('./helpers');
const catchRejection = helper.catchRejection;

var d360Instance = ''

function integrationUpdate() {
  return (req, res) => {
    const filesTranslations = req.body;

    // prepare files translations object to translations array for using on map and forEach functions
    const translations = Object.keys(filesTranslations).reduce((acc, fileId) =>
      ([...acc, ...filesTranslations[fileId].map(lId =>
        ({ fileId: fileId, languageId: lId })
      )]), []
    );

    //instance initialization for axios
    d360Instance = axios.create({
      baseURL: res.itntegrationCredentials.url,
      headers: { 'Content-Type': 'application/json', 'api_token': res.itntegrationCredentials.token }
    }); 

    prepareData(filesTranslations, translations, res)
      .then(preparedData => {
        // Do next for each selected translations
        return Promise.all(translations.map((t, index) => updateIntegrationFile({ ...preparedData, t, index, res })));
      })
      .then(responses => {
        res.status(200).json(''); //responses.data closes the circular reference issue.
      })
      .catch(catchRejection('Cant upload files to integration', res));
  }
}

module.exports = integrationUpdate;

const prepareData = (filesTranslations, translations, res) => {
  return new Promise((resolve, reject) => {

    const integrationApiClient = d360Instance;
    const crowdinApi = res.crowdinApiClient;
    const projectId = res.origin.context.project_id;
    let filesById = {};
    let integrationFilesById = {};
    let integrationFilesList = [];
    let projectVersionId = ''
    // get all campaigns list and store it on integrationFilesList



    integrationApiClient.get('/ProjectVersions')
      .then(function (res) {
        projectVersionId = res.data.data[0].id;
      }).then(() => {

        integrationApiClient.get(`/ProjectVersions/${projectVersionId}/articles`)
          .then(list => {
            integrationFilesList = list.data.data;
            // get all selected source files from Crowdin
            return Promise.all(Object.keys(filesTranslations).map(fId => crowdinApi.sourceFilesApi.getFile(projectId, fId)))
          })
          .then(responses => {
            // Store selected files responses on filesById
            filesById = responses.reduce((acc, fileData) => ({ ...acc, [`${fileData.data.id}`]: fileData.data }), {});
            // Get all selected files source campaigns
            return Promise.all(Object.values(filesById).map(f => integrationApiClient.get(`/Articles/${f.name.replace('.md', '')}`)))
          })
          .then(integrationFiles => {
            // Store campaigns date on object by id
            integrationFilesById = integrationFiles.reduce((acc, fileData) => ({ ...acc, [`${fileData.id}`]: fileData }), {});
            // For each selected translation build translation on Crowdin by file id and language
            return Promise.all(translations.map(t =>
              crowdinApi.translationsApi.buildProjectFileTranslation(projectId, t.fileId, { targetLanguageId: t.languageId, exportAsXliff: false })
            ))
          })
          .then(responses => {
            // Get all links for translations build, get date for each link
            return Promise.all(responses.map(r => axios.get(r.data.url)))
          })
          .then(buffers => {
            // Get array of translations content
            const translatedFilesData = buffers.map(b => b.data);
            resolve({ filesById, integrationFilesById, integrationFilesList, translatedFilesData })
          })
          .catch(e => reject(e))
      })

  })

};

const updateIntegrationFile = (params) => {
  const { filesById, integrationFilesById, integrationFilesList, translatedFilesData, t, index, res } = params;
  const fileName = `${filesById[t.fileId].title}`;//${t.languageId}`; // prepare file translation name
  const integrationTranslationFile = integrationFilesList.find(f => f.slug === fileName.replace('.md', '')); // Try find translation on
  const integrationApiClient = d360Instance;

  if (integrationTranslationFile) {
    // We find translation for this file and this language, update it
    //return integrationApiClient.put('/Articles/' + integrationTranslationFile.id, {content:'this needs the from code'});
    return integrationApiClient.put('/Articles/' + integrationTranslationFile.id, { content: translatedFilesData[index] })
  } 
  // else {
  //   // We don't find translation for this file and language
  //   // Get origin file from integration
  //   let originFile = integrationFilesById[filesById[t.fileId].name.replace('.html', '')];
  //   // Prepare payload to create new campaign
  //   let payload = {
  //     type: originFile.type,
  //     settings: { ...originFile.settings, template_id: undefined, title: originFile.settings.title + `/${t.languageId}` },
  //     variate_settings: originFile.variate_settings,
  //     tracking: originFile.tracking
  //   };
  //   // Create new campaign
  //   return integrationApiClient.post('/campaigns', payload)
  //     .then(res => {
  //       // set current translations as campaign content
  //       return integrationApiClient.put('/campaigns/' + res.id + '/content', { html: translatedFilesData[index] })
  //     })
  // }
};