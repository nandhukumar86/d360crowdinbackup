const Mapping = require('./models/mapping');
//axios package
const axios = require('axios');
const helper = require('./helpers');
const nodeTypes = helper.nodeTypes;

function crowdinUpdate() {
  return (req, res) => {
    const crowdinApi = res.crowdinApiClient;
    const fileIds = req.body.filter(fId => fId.node_type == nodeTypes.FILE);
    const projectId = res.origin.context.project_id;
    const d360Instance = res.d360Instance;

    let integrationFiles = [];
    let integrationTitles = [];
    let allfolders = [];
    cloudinDirectoryNames = [];
    cloudinBranchNames = [];

    const directories = req.body.filter(fid => fid.node_type == nodeTypes.FOLDER || fid.node_type == nodeTypes.BRANCH);
    const parentDirectories = directories.filter(d => d.parent_id == 0)

    Promise.all([crowdinApi.sourceFilesApi.listProjectBranches(projectId), crowdinApi.sourceFilesApi.listProjectDirectories(projectId)])
      .then(values => {
        cloudinBranchNames = values[0].data;
        cloudinDirectoryNames = values[1].data;
        return Promise.all(parentDirectories.map(dir => {
          var existingBranchId = cloudinBranchNames.find(b => ParseUniqueId(b.data.name) == dir.id);
          if (!!existingBranchId)
            return crowdinApi.sourceFilesApi.getBranch(projectId, existingBranchId.data.id)
          else
            return crowdinApi.sourceFilesApi.createBranch(projectId, { name: `${dir.name} (${dir.id})`, title: dir.name })
        }))
          .then(branchFolders => {
            return Promise.all(branchFolders.map(branchFolder => {
              var categoriesList = directories.filter(d => d.parent_id == ParseUniqueId(branchFolder.data.name));
              return Promise.all(categoriesList.map(category => {
                var existingDirectoryId = cloudinDirectoryNames.find(b => ParseUniqueId(b.data.name) == category.id);
                if (!!existingDirectoryId)
                  return crowdinApi.sourceFilesApi.getDirectory(projectId, existingDirectoryId.data.id)
                else
                  return crowdinApi.sourceFilesApi.createDirectory(projectId, { name: `${category.name} (${category.id})`, branchId: branchFolder.data.id, title: category.name })
              }))
                .then(categoryFolders => {
                  return Promise.all(categoryFolders.map(categoryFolder => {
                    var subCategoriesList = directories.filter(d => d.parent_id == ParseUniqueId(categoryFolder.data.name));
                    return Promise.all(subCategoriesList.map(subCategory => Recursion(subCategory, categoryFolder.data.id)))
                  }))
                })
            }))
          })
      })
      .then(() => {
        Promise.all([crowdinApi.sourceFilesApi.listProjectBranches(projectId), crowdinApi.sourceFilesApi.listProjectDirectories(projectId)])
          .then(values => {
            allfolders = values[1].data;

            Promise.all(fileIds.map(fid => d360Instance.get(`/Articles/${fid.id}`)))
              .then((values) => {

                // Prepare responses for better use in next function
                integrationFiles = values.map(
                  (f, index) => ({
                    ...f,
                    content: fileIds[index].type == "html" ? f.data.data.html_content : f.data.data.content,
                    title: fileIds[index].slug || (fileIds[index].settings || {}).name || fileIds[index].id,
                    name: fileIds[index].name,
                    ifId: `${fileIds[index].slug}_content_${fileIds[index].id}`,
                    folderId: allfolders.find(f => ParseUniqueId(f.data.name) == fileIds[index].parent_id).data.id,//findFolderId(`${fileIds[index].parent_name} (${fileIds[index].parent_id})`),
                    filetype: fileIds[index].type
                  })
                );

                integrationTitles = values.map(
                  (f, index) => ({
                    ...f,
                    content: f.data.data.title,
                    title: fileIds[index].slug || (fileIds[index].settings || {}).name || fileIds[index].id,
                    name: fileIds[index].name,
                    ifId: `${fileIds[index].slug}_title_${fileIds[index].id}`,
                    folderId: allfolders.find(f => ParseUniqueId(f.data.name) == fileIds[index].parent_id).data.id,//findFolderId(`${fileIds[index].parent_name} (${fileIds[index].parent_id})`),
                    filetype: 'txt' //Considering title is always text.
                  })
                );

                integrationTitles.forEach(title => {
                  integrationFiles.push(title);
                });

                // Upload all integration file content to Crowdin storage
                return Promise.all(
                  integrationFiles.map(f => crowdinApi.uploadStorageApi.addStorage(`${f.ifId}.${f.filetype}`, `${f.content}`))
                )
              })
              .then(storageIds => {
                // Prepare added files from returned storageIds and integration files
                let addedFiles = storageIds.map((f, i) =>
                  ({
                    ...f.data,
                    title: integrationFiles[i].title,
                    integrationFileId: integrationFiles[i].ifId,
                    integrationUpdatedAt: integrationFiles[i].create_time || Date.now(),
                    folderId: integrationFiles[i].folderId
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
                              title: f.title,
                              directoryId: f.folderId
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
                          directoryId: f.folderId || 'no folder'
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

          })
      });


    function Recursion(subCategory, folderId) {
      var promise = new Promise((res, rej) => {
        var existingDirectoryId = cloudinDirectoryNames.find(b => ParseUniqueId(b.data.name) == subCategory.id);
        if (!!existingDirectoryId)
          return res(crowdinApi.sourceFilesApi.getDirectory(projectId, existingDirectoryId.data.id))
        else
          return res(crowdinApi.sourceFilesApi.createDirectory(projectId, { name: `${subCategory.name} (${subCategory.id})`, directoryId: folderId, title: subCategory.name }))
      });
      return promise.then(res => {
        var childSubCategories = directories.filter(d => d.parent_id == ParseUniqueId(res.data.name));
        return Promise.all(childSubCategories.map(childSubCategory => Recursion(childSubCategory, res.data.id)));
      })
    }

    function ParseUniqueId(folderName) {
      var items = folderName.split(' ')
      return items[items.length - 1].replace('(','').replace(')','');
    }
  }
}

module.exports = crowdinUpdate;