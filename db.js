var Sequelize = require('sequelize');
var env = process.env.NODE_ENV || 'development';
var sequelize;

if(env === 'production'){
    sequelize = new Sequelize(process.env.DATABASE_URL, {
        'dialect': 'postgress',
    })

} else {
    sequelize = new Sequelize(undefined, undefined, undefined, {
        'dialect': 'sqlite',
        'storage': __dirname + '/data/integration.sqlite',
    });
}
// Initialize DB object
var db = {};
// Connect models to DB object
db.organization = sequelize.import(__dirname + '/models/organization.js');
db.integration = sequelize.import(__dirname + '/models/integration.js');
db.mapping = sequelize.import(__dirname + '/models/mapping.js');
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;