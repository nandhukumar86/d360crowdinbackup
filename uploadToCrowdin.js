const Mapping = require('./models/mapping');
//axios package
const axios = require('axios');
const helper = require('./helpers');
const nodeTypes = helper.nodeTypes;

var d360Instance = ''

function crowdinUpdate() {
  return (req, res) => {
    const crowdinApi = res.crowdinApiClient;
    const fileIds = req.body.filter(fId => fId.node_type == nodeTypes.FILE);
    const projectId = res.origin.context.project_id;

    //instance initialization for axios
    d360Instance = axios.create({
      baseURL: res.itntegrationCredentials.url,
      headers: { 'Content-Type': 'application/json', 'api_token': res.itntegrationCredentials.token }
    });

    let integrationFiles = [];

    // Get content for all selected integration files
    Promise.all(fileIds.map(fid => d360Instance.get(`/Articles/${fid.id}`)))
      .then((values) => {
      
        //console.log(values[0].data.data.html_content);
        
        // Prepare responses for better use in next function
        integrationFiles = values.map(
          (f, index) => ({
            ...f,
            content: f.data.data.content || f.data.data.content || f.archive_html || f.html,
            title: fileIds[index].slug || (fileIds[index].settings || {}).name || fileIds[index].id,
            name: fileIds[index].name,
            //ifId: fileIds[index].id
            ifId: fileIds[index].slug
          })
        );
        // Upload all integration file content to Crowdin storage
        return Promise.all(
          integrationFiles.map(f => crowdinApi.uploadStorageApi.addStorage(`${f.ifId}.txt`, `${f.content}`))
        )
      })
      .then(storageIds => {
        // Prepare added files from returned storageIds and integration files
        let addedFiles = storageIds.map((f, i) =>
          ({
            ...f.data,
            title: integrationFiles[i].title,
            integrationFileId: integrationFiles[i].ifId,
            integrationUpdatedAt: fileIds[i].create_time || Date.now(),
          })
        );

        // for each added file do next
        return Promise.all(addedFiles.map(f => {
          // Try find file on mapping table
          return Mapping.findOne({where: {projectId: projectId, integrationFileId: f.integrationFileId}})
            .then(file => {
              if(!!file) {
                // Find file try get it
                return crowdinApi.sourceFilesApi.getFile(projectId, file.crowdinFileId)
                  .then(() => {
                    // Try update file on crowdin
                    return crowdinApi.sourceFilesApi.updateOrRestoreFile(projectId, file.crowdinFileId, {storageId: f.id})
                  })
                  .then(response => {
                    // Update mapping record on DB
                    return file.update({crowdinUpdatedAt: response.data.updatedAt, integrationUpdatedAt: f.integrationUpdatedAt})
                  })
                  .catch(() => {
                    // Can't get file from crowdin, looks like it removed, try create new one
                    return crowdinApi.sourceFilesApi.createFile(projectId, {
                      storageId: f.id,
                      name: f.fileName,
                      title: f.title
                    })
                      .then(response => {
                        // update mapping record on DB
                        return file.update({
                          integrationUpdatedAt: f.integrationUpdatedAt,
                          crowdinUpdatedAt: response.data.updatedAt,
                          crowdinFileId: response.data.id,
                        })
                      })
                  });
              } else {
                // Can't find file on mapping table create new on Crowdin
                return crowdinApi.sourceFilesApi.createFile(projectId, {
                  storageId: f.id,
                  name: f.fileName || 'no file name',
                  title: f.title || 'no title'
                })
                  .then(response => {
                    // Create new record on mapping table
                    return Mapping.create({
                      domain: res.origin.domain,
                      projectId: projectId,
                      integrationUpdatedAt: f.integrationUpdatedAt,
                      crowdinUpdatedAt: response.data.updatedAt,
                      integrationFileId: f.integrationFileId,
                      crowdinFileId: response.data.id,
                    })
                  })
              }
            })
        }))
      })
      .then(responses => {
        // all goes good rend response back
        res.json(responses);
      })
      .catch(e => {
        // something goes wrong, send exact error back
        return res.status(500).send(e);
      });
  }
}

module.exports = crowdinUpdate;