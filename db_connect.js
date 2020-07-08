const Sequelize = require('sequelize');
const env = process.env.NODE_ENV || 'development';
let sequelize;

if(env === 'production'){
    sequelize = new Sequelize(process.env.MSSQLDB, process.env.DB_USERID, process.env.DB_PWD, {
        host: process.env.DATABASE_SERVER,
        dialect: 'mssql',
        pool: {
            max: 5,
            min: 0,
            idle: 10000
        },
        dialectOptions: {
            options: {
                encrypt: true,
            }
        }
    });

} else {
    sequelize = new Sequelize(undefined, undefined, undefined, {
        'dialect': 'sqlite',
        'storage': __dirname + '/data/integration.sqlite',
    });
}

module.exports = sequelize;