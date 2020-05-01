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
    let folderDirectoryIDMapping = [];
    let parentFolderMapping = [];

    const directories = req.body.filter(fid => fid.node_type == nodeTypes.FOLDER);

    crowdinApi.sourceFilesApi.listProjectDirectories(projectId)
      .then(values => {
        cloudinDirectoryNames = values.data.map(d => d.data.name);

        values.data.forEach(element => {
          folderDirectoryIDMapping.push({
            folderName: element.data.name,
            folderId: element.data.id
          });
        });

        Promise.all(directories.map(element => {
          if (!cloudinDirectoryNames.includes(element.name)) {
            return crowdinApi.sourceFilesApi.createDirectory(projectId, {
              name: element.name,
              directoryId: null
            }).then(r=>{
              folderDirectoryIDMapping.push({
                folderName: r.data.name,
                folderId: r.data.id
              });
            })
          }
        }))
          .then(resp => {
            directories.forEach(element => {
              parentFolderMapping.push({
                folderName: element.name,
                folderId: folderDirectoryIDMapping.filter(t => t.folderName == element.name)[0].folderId,
                parentFolderId: folderDirectoryIDMapping.filter(t => t.folderName == element.parent_name)[0].folderId
              });
            });

            //able ot get mapping columns
            console.log(parentFolderMapping);
            

            Promise.all(parentFolderMapping.map(f=>{
              if(f.folderName != 'Parent')
              {
                var array = [{
                  op: "replace",
                  path: "/directoryId",
                  values: f.parentFolderId
                }];
                //return crowdinApi.sourceFilesApi.editDirectory(projectId, f.folderId, array)
                crowdinApi.sourceFilesApi.createDirectory(projectId, {
                  name: `${f.folderId}_created`,
                  directoryId: null
                })
              }
            }))
            .then(res=>{
              console.log(res);
            });

          })
      })






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
            ifId: fileIds[index].slug
          })
        );
        // Upload all integration file content to Crowdin storage
        return Promise.all(
          integrationFiles.map(f => crowdinApi.uploadStorageApi.addStorage(`${f.ifId}.md`, `${f.content}`))
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
          return Mapping.findOne({ where: { projectId: projectId, integrationFileId: f.integrationFileId } })
            .then(file => {
              if (!!file) {
                // Find file try get it
                return crowdinApi.sourceFilesApi.getFile(projectId, file.crowdinFileId)
                  .then(() => {
                    // Try update file on crowdin

                    return crowdinApi.sourceFilesApi.updateOrRestoreFile(projectId, file.crowdinFileId, { storageId: f.id })
                  })
                  .then(response => {
                    // Update mapping record on DB
                    return file.update({ crowdinUpdatedAt: response.data.updatedAt, integrationUpdatedAt: f.integrationUpdatedAt })
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
                  title: f.title || 'no title',
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