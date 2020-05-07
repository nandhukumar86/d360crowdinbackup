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
    let folderDirectoryIDMapping = [];
    let parentFolderMapping = [];

    const directories = req.body.filter(fid => fid.node_type == nodeTypes.FOLDER || fid.node_type == nodeTypes.BRANCH);

    const parentDirectories = directories.filter(d => d.parent_id == 0)

    //parentDirectories.foreach(element => crowdinApi.sourceFilesApi.createBranch(projectId, { name: element.name }))

    Promise.all(parentDirectories.map(dir => crowdinApi.sourceFilesApi.createBranch(projectId, { name: dir.name, title: dir.id })))
      .then(branchFolders => {
        branchFolders.map(branchFolder => {
          var categoriesList = directories.filter(d => d.parent_id == branchFolder.data.title);
          Promise.all(categoriesList.map(category => crowdinApi.sourceFilesApi.createDirectory(projectId, { name: category.name, branchId: branchFolder.data.id, title: category.id })))
            .then(categoryFolders => {
              categoryFolders.map(categoryFolder => {
                var subCategoriesList = directories.filter(d => d.parent_id == categoryFolder.data.title);
                subCategoriesList.forEach(subCategory => {
                  Recursion(subCategory, categoryFolder.data.id);
                });
              })
            })
        })
      })
      .catch(e => {
        console.log(e)
      })

    function Recursion(subCategory, folderId) {

      crowdinApi.sourceFilesApi.createDirectory(projectId, { name: subCategory.name, directoryId: folderId, title: subCategory.id })
        .then(res => {
          var childSubCategories = directories.filter(d => d.parent_id == res.data.title);
          childSubCategories.forEach(childSubCategory => {
            Recursion(childSubCategory, res.data.id);
          });
        })

      //console.log(`${subCategory.name} ${parentId} ${folderId}`);
    }


    if (false) {
      crowdinApi.sourceFilesApi.listProjectDirectories(projectId)
        .then(values => {
          cloudinDirectoryNames = values.data.map(d => d.data.name);

          values.data.forEach(element => {
            folderDirectoryIDMapping.push({
              folderName: element.data.name,
              folderId: element.data.id,
            });
          });

          Promise.all(directories.map(element => {
            if (!cloudinDirectoryNames.includes(`${element.name} (${element.id})`)) {
              return crowdinApi.sourceFilesApi.createDirectory(projectId, {
                name: `${element.name} (${element.id})`,
                directoryId: null,
              }).then(r => {
                folderDirectoryIDMapping.push({
                  folderName: r.data.name,
                  folderId: r.data.id,
                });
              })
            }
          }))
            .then(resp => {
              directories.forEach(element => {
                if (element.name != 'Project') {
                  parentFolderMapping.push({
                    folderName: element.name,
                    folderId: folderDirectoryIDMapping.find(t => t.folderName == `${element.name} (${element.id})`).folderId,
                    parentFolderId: folderDirectoryIDMapping.find(t => t.folderName == `${element.parent_name} (${element.parent_id})`).folderId
                  });
                }
              });

              return Promise.all(parentFolderMapping.map(f => {
                var array = [{
                  op: "replace",
                  path: "/directoryId",
                  value: f.parentFolderId
                }];
                return crowdinApi.sourceFilesApi.editDirectory(projectId, f.folderId, array)
              }))
            })
        })
    }

    function findFolderId(folderName) {
      return folderDirectoryIDMapping.find(a => a.folderName == folderName).folderId
    }

    // Get content for all selected integration files
    Promise.all(fileIds.map(fid => d360Instance.get(`/Articles/${fid.id}`)))
      .then((values) => {

        // Prepare responses for better use in next function
        integrationFiles = values.map(
          (f, index) => ({
            ...f,
            content: fileIds[index].type == "html" ? f.data.data.html_content : f.data.data.content,
            title: fileIds[index].slug || (fileIds[index].settings || {}).name || fileIds[index].id,
            name: fileIds[index].name,
            ifId: `${fileIds[index].slug}_content`,
            folderId: findFolderId(`${fileIds[index].parent_name} (${fileIds[index].parent_id})`),
            filetype: fileIds[index].type
          })
        );

        integrationTitles = values.map(
          (f, index) => ({
            ...f,
            content: f.data.data.title,
            title: fileIds[index].slug || (fileIds[index].settings || {}).name || fileIds[index].id,
            name: fileIds[index].name,
            ifId: `${fileIds[index].slug}_title`,
            folderId: findFolderId(`${fileIds[index].parent_name} (${fileIds[index].parent_id})`),
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
  }
}

module.exports = crowdinUpdate;