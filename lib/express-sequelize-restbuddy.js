'use strict';

var _ = require('lodash');
var Sequelize = require('sequelize');
var debug = require('debug')('examples/basic-rest-api');

/**
 * Enum for possible request types
 * @readonly
 * @enum {string}
 */
var RequestTypes = Object.freeze({
  List: 'list',
  Show: 'show',
  Update: 'update',
  Create: 'create',
  Destroy: 'destroy'
});


/**
 * Get a route handler
 *
 * @param {Sequelize} sequelize - An initialized Sequelize object
 * @param {object} [options]
 * @param {number} [options.maxItems=100] - Max items per page for pagination
 * @param {function} [options.formatter] - A format function to transform the results
 * @param {object} [options.conditionTransformers] - An object containing functions to map query parameter values to sequelize conditions (example: search)
 * @param {bool} [options.linkHeaderPagination] - If pagination link header should be included in response
 * @returns {Function}
 */
module.exports = function (sequelize, options) {
  options = _.defaults(options || {}, {
    maxItems: 100,
    formatter: _.identity,
    conditionTransformers: {},
    linkHeaderPagination: false // TODO: Implement
  });

  return function (req, res, next) {
    var Utils = sequelize.Utils;
    var resource = _.rest(req.route.path.split('/'))[0];
    var modelName = Utils.inflection.capitalize(Utils.singularize(resource));
    var model = sequelize.models[modelName];
    var queryOptions = {};

    // Order
    var order = parseOrder(req.query.order, model);
    if (order) {
      queryOptions.order = order;
    }

    // Pagination
    if (parseInt(req.query.items)) {
      queryOptions.limit = Math.min(parseInt(req.query.items), options.maxitems) || null;
      if (queryOptions.limit) {
        queryOptions.offset = parseInt(req.query.page) * queryOptions.limit || null;
      }
    }

    // Where
    var parameters = _.merge(req.query, req.params);
    debug(parameters);
    var conditions = applyConditionTransformers(
      filterUnknownConditions(parameters, model, options.conditionTransformers),
      options.conditionTransformers
    );
    debug(conditions);

    // Build options
    queryOptions.where = conditions;

    // Execute query
    if (requestType(req) === RequestTypes.Show) {
      model.findOne(queryOptions)
        .then(function (item) {
          if (!item) {
            res.status(404).json({ message: model.name + ' not found' });
          } else {
            res.json(options.formatter(item));
          }
        })
        .error(next);
    } else if (requestType(req) === RequestTypes.List) {
      model.findAll(queryOptions)
        .then(function (results) {
          res.json(options.formatter(results));
        })
        .error(next);
    } else if (requestType(req) === RequestTypes.Update) {
      model.find(queryOptions)
        .then(function(item) {
          return item.updateAttributes(req.body);
        })
        .then(function(item) {
          res.json(options.formatter(item));
        })
        .error(next);
    } else {
      next(new Error('Unknown request type'));
    }

    // TODO: Implement Create and Destroy
  };
};

/**
 * Generate routes for a resource
 *
 * @param {Sequelize} sequelize - An initialized Sequelize object
 * @param {Express instance} app - An initialized Express object
 * @param {string} - Name of resource
 */
module.exports.resources = function (sequelize, app, resource) {
  app.get('/' + resource + '/:id', module.exports(sequelize));
  app.patch('/' + resource + '/:id', module.exports(sequelize));
  app.put('/' + resource + '/:id', module.exports(sequelize));
  // TODO Add the rest of the REST request types.
};

/**
 * Determine the type of this request (list, show, update ..)
 *
 * @param req
 * @returns {string}
 */
function requestType (req) {
  var routeParts = req.route.path.split('/');
  if (req.method === 'GET') {
    return isParam(_.last(routeParts)) ? RequestTypes.Show : RequestTypes.List;
  } else if (req.method === 'POST' && !isParam(_.last(routeParts))) {
    return RequestTypes.Create;
  } else if ((req.method === 'PUT' || req.method === 'PATCH') && isParam(_.last(routeParts))) {
    return RequestTypes.Update;
  } else if (req.method === 'DELETE' && isParam(_.last(routeParts))) {
    return RequestTypes.Destroy;
  } else {
    return null;
  }
}

/**
 * Returns whether a string is a route parameter
 *
 * @param {string} x
 * @returns {boolean}
 */
function isParam (x) {
  return typeof x === 'string' && x.length > 0 && x[0] === ':';
}

/**
 * Filter out conditions that do no match any fields in the model
 *
 * @param {object} conditions - Object
 * @param {Model} model - A sequelize model object
 * @param {object} conditionTransformers - List of allowed query transformers
 * @returns {object} Conditions object with unknown fields removed
 */
function filterUnknownConditions (conditions, model, conditionTransformers) {
  var modelAttributes = _.keys(model.rawAttributes);
  var transformerKeys = _.keys(conditionTransformers);
  return _.pick(conditions, _.union(transformerKeys, modelAttributes));
}

/**
 * Apply a specified functions to query parameters
 *
 * @param {object} conditions
 * @param {object} transformers
 * @returns {object} A sequelize where condition object
 */
function applyConditionTransformers (conditions, transformers) {
  var transformedConditions = _.compact(_.map(conditions, applyMatchingTransform));
  var nonTransformedConditions = _.omit(conditions, _.keys(transformers));
  conditions = transformedConditions.concat([nonTransformedConditions]); // A little hack since push does not return the array
  return Sequelize.and(conditions);

  function applyMatchingTransform (v, k) {
    return transformers[k] ? transformers[k](v) : null;
  }
}

/**
 * Parse the order query parameter value
 *
 * @param {string} order
 * @param {Model} model
 * @returns {string} A string passed to sequelize
 */
function parseOrder (order, model) {
  var desc = false;
  if (order) {
    if (order[0] === '-') {
      order = order.slice(1);
      desc = true;
    }
    if (model.rawAttributes[order]) {
      if (desc) {
        order += ' DESC';
      }
      return order;
    } else {
      return null;
    }
  }
}