var YAML = require( 'yamljs' );
var schemaManager = require( './schema' );
var dbManager = require( './db' );
var extend = require( 'util' )._extend;
var Collection = require( './collection' ).Collection;
var express = require( 'express' );
var fs = require( 'fs' );

function loadScripts( path, callback ) {
    callback = callback || function() {};
    var scripts = [];
    fs.readdir( path, function( err, files ) {
        if ( err ) {
            console.error( 'endpoint: Error reading directory: ' + path + '. Error: ' + err );
            callback( { error: 'scriptsdir', message: 'Error reading scripts dir', details: err } );
            return;
        }
        var pending = files.length;
        if ( !pending ) { callback( false, [] ); };
        files.forEach( function( file ) {
            var fileName = path + '/' + file;
            fs.stat( fileName, function( err, stat ) {
                if ( err || !stat ) {
                    console.error( 'endpoint: Error reading file: ' + fileName + '. Error: ' + err );
                    --pending;
                    if ( !pending ) callback( false );
                    return;
                }
                if ( stat.isDirectory() ) {
                    loadScripts( fileName, function( s ) {
                        --pending;
                        Array.prototype.push.apply( scripts, s );
                        if ( !pending ) callback( false, scripts );
                    } ); 
                    return;
                }
                // console.log( 'script ext ' + fileName.slice( -3 ) );
                if ( fileName.slice( -3 ) == '.js' ) {
                    console.log( 'endpoint: loading script ' + fileName );
                    require( fileName.slice( 0, -3 ) );
                    scripts.push( fileName );
                    --pending;
                    if ( !pending ) callback( false, scripts );
                }
            } );
        } );
    } );
}

function setupAPI( app, collection, db ) {
    var schema = collection.schema;
    console.log( 'endpoint: registering collection uri ' + schema.uri );
    app.all( schema.uri, function( req, res, next ) {
        // console.log( 'collection request' );
        req.collection = collection;
        next();
    } );
    app.get( schema.uri, function( req, res, next ) {
        // console.log( 'list collection', collection );
        collection.list( { limit: 100 }, function( err, items ) {
            if ( err ) {
                return res.send( 500, err );
            }
            req.resource = items;
            collection.trigger( 'list', req, res, items, next );
        } );
    } );
    app.get( schema.uri, function( req, res, next ) {
        // console.log( 'sending collection' );
        res.send( req.resource );
    } );
    app.post( schema.uri, function( req, res, next ) {
        // console.log( 'collection insert', req.body );
        collection.trigger( 'validate', req, res, req.resource, next );
    } );
    app.post( schema.uri, function( req, res, next ) {
        // console.log( 'inserting to collection' );
        collection.insert( req.body, function( err, resource ) {
            if ( err ) {
                return res.send( 500, err );
            }
            req.resource = resource;
            collection.trigger( 'create', req, res, resource, next );
        } );
    } );
    app.post( schema.uri, function( req, res, next ) {
        // console.log( 'sending inserted resource' );
        res.send( req.resource );
    } );

    var resourceURI = schema.resourceSchema.uri;
    console.log( 'endpoint: registering resource uri', resourceURI );
    app.all( resourceURI, function( req, res, next ) {
        // console.log( 'get resource', req.params );
        var query = {};
        for ( var i in req.params ) {
            if ( req.params.hasOwnProperty( i ) ) {
                var propertySchema = schema.resourceSchema.properties[ i ];
                if ( !propertySchema ) {
                    return res.send( 500, { error: "nosuchproperty", message: "No such property " + i + " on resource " + schema.name } );
                }
                if ( propertySchema.type == 'id' || propertySchema.type == 'int' ) {
                    query[ i ] = parseInt( req.params[ i ] );
                }
                else if ( propertySchema.type == 'float' ) {
                    query[ i ] = parseFloat( req.params[ i ] );
                }
                else {
                    query[ i ] = req.params[ i ];
                }
            }
        }
        // console.log( 'finding', query );
        collection.findOne( query, function( err, resource ) {
            // console.log( 'found', query, err, resource );
            if ( err ) {
                return res.send( 500, err );
            }
            else if ( !resource ) {
                return res.send( 404, { error: "notfound", message: "Resource not found." } );
            }
            req.resource = resource;
            // console.log( 'resource', resource );
            next();
        } );
    } );
    app.get( resourceURI, function( req, res, next ) {
        // console.log( 'view resource' );
        collection.trigger( 'view', req, res, req.resource, next );
    } );
    app.get( resourceURI, function( req, res, next ) {
        var resource = req.resource;
        res.send( resource );
    } );
    app.put( resourceURI, function( req, res, next ) {
        collection.trigger( 'validate', req, res, req.resource, next );
    } );
    // complete update
    app.put( resourceURI, function( req, res, next ) {
        // console.log( 'put resource' );
       var resource = req.resource; 
       resource.modify( req.body, function( err, resource ) {
           if ( err ) {
               return res.send( err );
           }
           req.resource = resource;
           collection.trigger( 'update', req, res, resource, next );
       } );
    } );
    app.put( resourceURI, function( req, res, next ) {
        var resource = req.resource;
        res.send( resource );
    } );
    // partial update
    app.patch( resourceURI, function( req, res, next ) {
        collection.trigger( 'validate', req, res, req.resource, next );
    } );
    app.patch( resourceURI, function( req, res, next ) {
        // console.log( 'patch resource' );
        var resource = req.resource;
        resource.modify( req.body, function( err, resource ) {
            if ( err ) {
               return res.send( err );
            }
            req.resource = resource;
            collection.trigger( 'update', req, res, resource, next );
        } );
    } );
    app.patch( resourceURI, function( req, res, next ) {
        var resource = req.resource;
        res.send( resource );
    } );
    app.delete( resourceURI, function( req, res, next ) {
        // console.log( 'delete resource' );
        var resource = req.resource;
        resource.remove( function( err ) {
            if ( err ) {
                return res.send( 500, err );
            }
            collection.trigger( 'delete', req, res, resource, next );
        } );
    } );
    app.delete( resourceURI, function( req, res, next ) {
        var resource = req.resource;
        res.send( resource );
    } );

    app.set( schema.name, collection );
}

express.application.collection = function( name ) {
    return this.get( 'collection/' + name );
};

express.application.run = function() {
    var app = this;
    app.use( express.bodyParser() );
    app.use( function( req, res, next ) {
        res.header( 'X-Powered-By', 'Endpoint' );
        next();
    } );

    var baseConfig = {
        server: {
            port: 8080
        },
        database: {
            name: 'test',
            host: '127.0.0.1'
        }
    };
    var exists = fs.existsSync( process.cwd() + '/config.yml' );
    if ( !exists ) {
        console.log( 'endpoint: No config.yml file found. Using default configuration.' );
        var config = baseConfig; 
    }
    else {
        var config = extend( baseConfig, YAML.load( 'config.yml' ) );
    }
    console.log( 'endpoint: using config', config );
    var collections = {};
    var db = dbManager.Database( 'mongodb://' + config.database.host + '/' + config.database.name );
    console.log( 'endpoint: loading schemata' );
    schemaManager.loadFromDirectory( process.cwd() + '/resources', function( err, schemata ) {
        if ( !schemata ) {
            console.error( 'endpoint: no resources found.' );
        }
        else {
            schemata.forEach( function( schema ) {
                if ( schema.type == 'collection' ) {
                    var collection = Collection( schema, db );
                    collections[ schema.name ] = collection;
                    setupAPI( app, collection, db );
                }
            } );
        }
        console.log( 'endpoint: loading scripts' );
        loadScripts( process.cwd() + '/scripts', function( err, scripts ) {
            if ( err ) {
                console.error( 'endpoint: failed loading scripts.' );
            }
            else if ( !scripts ) {
                console.error( 'endpoint: no scripts found.' );
            }
        } );
    } );
    app.listen( config.server.port );
    console.log( 'endpoint: listening on port', config.server.port );
}
var app = express();

module.exports = exports = app;
