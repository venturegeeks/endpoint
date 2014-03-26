var Schema = require( 'jugglingdb' ).Schema;

function Resource( schema, db ) {
    this.schema = schema;
    this.db = db;
    this._listeners = {};

    console.log( schema );
    console.log( schema.dbCollection );

    var modelProperties = {};
    for ( var propName in this.schema.properties ) {
        var property = this.schema.properties[ propName ];
        var types = {
            'id': Number,
            'string': String,
            'text': Schema.Text,
            'date': Date,
            'number': Number,
            'boolean': Boolean,
            'email': String
        };
        var modelProperty = { type: types[ property.type ] };
        if ( property.length ) {
            modelProperty.length = parseInt( property.length );
        }
        if ( property.index ) {
            modelProperty.index = true;
        }
        if ( property.default ) {
            modelProperty.default = property.default;
        }
        /*
        if ( property.optional !== 'true' ) {
            modelProperty.validatesPresenceOf( propName );
        }
        if ( property.unique === 'true' || property.type == 'id' ) {
            modelProperty.validatesUniquenessOf( propName );
        }
        */
        modelProperties[ propName ] = modelProperty
    }

    this.model = db.define( this.schema.name, modelProperties, { table: schema.dbCollection } );
}

Resource.prototype.list = function( req, res, next ) {
    // console.log( 'list collection', collection );
    if ( typeof req == 'function' ) {
        return this.addEventListener( 'list', req );
    }
    var self = this;
    this.model.all( function( err, items ) {
        if ( err ) {
            return res.send( 500, err );
        }
        req.items = items;
        self.trigger( 'list', req, res, items, next );
    } );
};

Resource.prototype.renderList = function( req, res, next ) {
    console.log( 'list' );
    console.log( req.items );
    var items = [];
    req.items.forEach( function( item ) {
        items.push( item.__data );
    } );
    res.send( items );
};

Resource.prototype.validate = function( req, res, next ) {
    // console.log( 'collection insert', req.body );
    if ( typeof req == 'function' ) {
        return this.addEventListener( 'validate', req );
    }
    this.trigger( 'validate', req, res, req.body, next );
};

Resource.prototype.create = function( req, res, next ) {
    // console.log( 'inserting to collection' );
    if ( typeof req == 'function' ) {
        return this.addEventListener( 'create', req );
    }
    var self = this;
    this.model.create( req.body, function( err, item ) {
        if ( err ) {
            return res.send( 500, err );
        }
        req.resource = item;
        self.trigger( 'create', req, res, item, next );
    } );
};

Resource.prototype.render = function( req, res, next ) {
    console.log( 'data', req.resource.__data );
    res.send( req.resource.__data );
};

Resource.prototype.initCollectionRequest = function( req, res, next ) {
    req.resource = this;
    next();
};

Resource.prototype.initResourceRequest = function( req, res, next ) {
    // console.log( 'get resource', req.params );
    /* TODO: dynamic query
    var query = {};
    var schema = this.schema;
    for ( var i in req.params ) {
        if ( req.params.hasOwnProperty( i ) ) {
            var propertySchema = schema.properties[ i ];
            if ( !propertySchema ) {
                return res.send( 500, { error: "nosuchproperty", message: "No such property " + i + " on resource " + schema.name } );
            }
            if ( propertySchema.type == 'int' ) {
                query[ propName ] = parseInt( req.params[ i ] );
            }
            else if ( propertySchema.type == 'float' ) {
                query[ propName ] = parseFloat( req.params[ i ] );
            }
            else {
                query[ propName ] = req.params[ i ];
            }
        }
    }
    */
    this.model.find( req.params[ 'id' ], function( err, resource ) {
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
};

Resource.prototype.view = function( req, res, next ) {
    if ( typeof req == 'function' ) {
        return this.addEventListener( 'view', req );
    }
    this.trigger( 'view', req, res, req.resource, next );
};

Resource.prototype.replace = function( req, res, next ) {
    // console.log( 'put resource' );
   var self = this;
   // TODO: check existence?
   this.model.upsert( req.body, function( err, resource ) {
       if ( err ) {
           return res.send( err );
       }
       req.resource = resource;
       self.trigger( 'update', req, res, req.resource, next );
   } );
};

Resource.prototype.update = function( req, res, next ) {
    if ( typeof req == 'function' ) {
        return this.addEventListener( 'update', req );
    }
    // console.log( 'patch resource' );
    var self = this; 
    var resource = req.resource; 
    resource.updateAttributes( req.body, function( err ) {
        if ( err ) {
           return res.send( err );
        }
        self.trigger( 'update', req, res, resource, next );
    } );
};

Resource.prototype.delete = function( req, res, next ) {
    // console.log( 'delete resource' );
    if ( typeof req == 'function' ) {
        return this.addEventListener( 'delete', req );
    }
    var resource = req.resource;
    var self = this;
    resource.destroy( function( err ) {
        if ( err ) {
            return res.send( 500, err );
        }
        self.trigger( 'delete', req, res, resource, next );
    } );
};

Resource.prototype.addEventListener = function( evt, callback ) {
    if ( !this._listeners[ evt ] ) {
        this._listeners[ evt ] = [ callback ];
    }
    else {
        this._listeners[ evt ].push( callback );
    }
};

Resource.prototype.trigger = function( evt, req, res, resource, next ) {
    // console.log( 'listeners', listeners, 'evt', evt );
    if ( !( evt in this._listeners ) || !this._listeners[ evt ].length ) {
        if ( typeof next == 'function' ) {
            next();
        }
    }
    else if ( !res ) {
        // simple event trigger (no req, res, or next)
        // dont wait for callback from listener
        resource = req;
        var l = this._listeners[ evt ]; 
        for ( i = 0; i < l.length; ++i ) {
            l[ i ]( resource );
        }
    }
    else {
        // complex event trigger, 
        // wait for callback from listener to go to next_listener
        // when the last listener responds, call next (4th parameter to trigger)
        var l = this._listeners[ evt ];
        var i = 0;
        function next_listener() {
            if ( l[ i ] ) {
                var listener = l[ i ];
                i += 1;
                listener( req, resource, function( code, data ) {
                    if ( code ) {
                        if ( !data ) {
                            data = code;
                            code = 200;
                        }
                        res.send( code, data );
                    }
                    else if ( !code ) {
                        next_listener();
                    }
                } );
            }
            else {
                next();
            }
        }
        next_listener();
    }
};

exports.Resource = Resource;
