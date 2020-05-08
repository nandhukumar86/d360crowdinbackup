const axios = require('axios').default;

const helper = require('./helpers');
const catchRejection = helper.catchRejection;
const nodeTypes = helper.nodeTypes;

function integrationUpdate() {
  return (req, res) => {
    const crowdinApi = res.crowdinApiClient;
    const projectId = res.origin.context.project_id;
    var filesTranslations = req.body;//.filter(f => f.type === nodeTypes.FILE);
    const reqBodyIds = Object.keys(req.body);

    Promise.all([crowdinApi.sourceFilesApi.listProjectDirectories(projectId), crowdinApi.sourceFilesApi.listProjectBranches(projectId)])
      .then(values => {
        console.log(values);

        values.forEach(foldertype => {
          foldertype.data.forEach(element => {
            if (reqBodyIds.includes(element.data.id.toString())) {
              delete filesTranslations[element.data.id.toString()];
            }
          });
        });
      })
      .then(() => {
        // prepare files translations object to translations array for using on map and forEach functions
        const translations = Object.keys(filesTranslations).reduce((acc, fileId) =>
          ([...acc, ...filesTranslations[fileId].map(lId =>
            ({ fileId: fileId, languageId: lId })
          )]), []
        );

        d360Instance = res.d360Instance;

        prepareData(filesTranslations, translations, res)
          .then(preparedData => {
            // Do next for each selected translations
            return Promise.all(translations.map((t, index) => updateIntegrationFile({ ...preparedData, t, index, res })));
          })
          .then(responses => {
            res.status(200).json(''); //responses.data closes the circular reference issue.
          })
          .catch(catchRejection('Cant upload files to integration', res));
      });

  }
}

module.exports = integrationUpdate;

function ParseFileName(filename) {
  var split1 = filename.split("_")
  var split2 = split1[2].split(".")

  return {
    slugName: split1[0],
    fileTranlationType: split1[1],
    articleId: split2[0],
    extension: split2[1]
  };
}

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
        projectVersionId = res.data.data.find(pv => pv.is_main_version).id;
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
            return Promise.all(Object.values(filesById).map(f => {
              return integrationApiClient.get(`/Articles/${ParseFileName(f.name).articleId}`)
              // if (f.name.indexOf(`_content.${f.type}`) > 0) {
              //   return integrationApiClient.get(`/Articles/${f.name.replace(`_content.${f.type}`, '')}`)
              // }
              // else if (f.name.indexOf(`_title.${f.type}`) > 0) {
              //   return integrationApiClient.get(`/Articles/${f.name.replace(`_title.${f.type}`, '')}`)
              // }
            }))
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
  const crowdinFileName = filesById[t.fileId].name; //${t.languageId}`; // prepare file translation name
  const integrationApiClient = d360Instance;

  const _obj = ParseFileName(crowdinFileName);
  const integrationTranslationFile = integrationFilesList.find(f => f.id == _obj.articleId); // Try find translation on

  if (integrationTranslationFile) {
    // We find translation for this file and this language, update it
    //return integrationApiClient.put('/Articles/' + integrationTranslationFile.id, {content:'this needs the from code'});
    var payload = {};

    if (_obj.fileTranlationType == "content" && _obj.extension == "md") {
      payload["content"] = translatedFilesData[index];
    }
    else if (_obj.fileTranlationType == "content" && _obj.extension == "html") {
      payload["html_content"] = translatedFilesData[index];
    }
    else if (_obj.fileTranlationType == "title" && _obj.extension == "txt") {
      payload["title"] = translatedFilesData[index];
    }
    return integrationApiClient.put('/Articles/' + integrationTranslationFile.id, payload);
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