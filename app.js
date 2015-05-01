//dependencies for each module used
var express = require('express');
var passport = require('passport');
var InstagramStrategy = require('passport-instagram').Strategy;
var http = require('http');
var path = require('path');
var handlebars = require('express-handlebars');
var bodyParser = require('body-parser');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var dotenv = require('dotenv');
var mongoose = require('mongoose');
var Facebook = require('fbgraph');
var Instagram = require('instagram-node-lib');
var async = require('async');
var request = require('request');
var app = express();

//local dependencies
var models = require('./models');

//client id and client secret here, taken from .env
dotenv.load();
var INSTAGRAM_CLIENT_ID = process.env.INSTAGRAM_CLIENT_ID;
var INSTAGRAM_CLIENT_SECRET = process.env.INSTAGRAM_CLIENT_SECRET;
var INSTAGRAM_CALLBACK_URL = process.env.INSTAGRAM_CALLBACK_URL;
Instagram.set('client_id', INSTAGRAM_CLIENT_ID);
Instagram.set('client_secret', INSTAGRAM_CLIENT_SECRET);

//connect to database
mongoose.connect(process.env.MONGODB_CONNECTION_URL);
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function (callback) {
  console.log("Database connected succesfully.");
});

// Passport session setup.
//   To support persistent login sessions, Passport needs to be able to
//   serialize users into and deserialize users out of the session.  Typically,
//   this will be as simple as storing the user ID when serializing, and finding
//   the user by ID when deserializing.  However, since this example does not
//   have a database of user records, the complete Instagram profile is
//   serialized and deserialized.
passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});


// Use the InstagramStrategy within Passport.
//   Strategies in Passport require a `verify` function, which accept
//   credentials (in this case, an accessToken, refreshToken, and Instagram
//   profile), and invoke a callback with a user object.
passport.use(new InstagramStrategy({
    clientID: INSTAGRAM_CLIENT_ID,
    clientSecret: INSTAGRAM_CLIENT_SECRET,
    callbackURL: INSTAGRAM_CALLBACK_URL
  },
  function(accessToken, refreshToken, profile, done) {
    // asynchronous verification, for effect...
   models.User.findOne({
    "ig_id": profile.id
   }, function(err, user) {
      if (err) {
        return done(err); 
      }
      
      //didnt find a user
      if (!user) {
        newUser = new models.User({
          name: profile.username, 
          ig_id: profile.id,
          ig_access_token: accessToken
        });

        newUser.save(function(err) {
          if(err) {
            console.log(err);
          } else {
            console.log('user: ' + newUser.name + " created.");
          }
          return done(null, newUser);
        });
      } else {
        //update user here
        user.ig_access_token = accessToken;
        user.save();
        process.nextTick(function () {
          // To keep the example simple, the user's Instagram profile is returned to
          // represent the logged-in user.  In a typical application, you would want
          // to associate the Instagram account with a user record in your database,
          // and return that user instead.
          return done(null, user);
        });
      }
   });
  }
));


//Configures the Template engine
app.engine('handlebars', handlebars({defaultLayout: 'layout'}));
app.set('view engine', 'handlebars');
app.set('views', __dirname + '/views');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(session({ secret: 'keyboard cat',
                  saveUninitialized: true,
                  resave: true}));
app.use(passport.initialize());
app.use(passport.session());

//set environment ports and start application
app.set('port', process.env.PORT || 3000);

// Simple route middleware to ensure user is authenticated.
//   Use this route middleware on any resource that needs to be protected.  If
//   the request is authenticated (typically via a persistent login session),
//   the request will proceed.  Otherwise, the user will be redirected to the
//   login page.
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { 
    return next(); 
  }
  res.redirect('/login');
}


function ensureAuthenticatedInstagram(req, res, next) {
  if (req.isAuthenticated() && !!req.user.ig_id) { 
    return next(); 
  }
  res.redirect('/login');
}


//routes
app.get('/', function(req, res){
  res.render('login');
});

app.get('/login', function(req, res){
  res.render('login', { user: req.user });
});

app.get('/account', ensureAuthenticated, function(req, res){
  res.render('account', {user: req.user});
});

app.get('/igphotos', ensureAuthenticatedInstagram, function(req, res){
  var query  = models.User.where({ ig_id: req.user.ig_id });
  query.findOne(function (err, user) {
    if (err) return err;
    if (user) {
      // doc may be null if no document matched
      Instagram.users.liked_by_self({
        access_token: user.ig_access_token,
        complete: function(data) {
          console.log(data);
          //Map will iterate through the returned data obj
          var imageArr = data.map(function(item) {
            //create temporary json object
            tempJSON = {};
            tempJSON.url = item.images.low_resolution.url;
            //insert json object into image array
            return tempJSON;
          });
          res.render('photos', {photos: imageArr});
        }
      }); 
    }
  });
});

app.get('/igMediaCounts', ensureAuthenticatedInstagram, function(req, res){
  var query  = models.User.where({ ig_id: req.user.ig_id });
  query.findOne(function (err, user) {
    if (err) return err;
    if (user) {
      Instagram.users.follows({ 
        user_id: user.ig_id,
        access_token: user.ig_access_token,
        complete: function(data) {
          // an array of asynchronous functions
          var asyncTasks = [];
          var mediaCounts = [];
           
          data.forEach(function(item){
            asyncTasks.push(function(callback){
              // asynchronous function!
              Instagram.users.info({ 
                  user_id: item.id,
                  access_token: user.ig_access_token,
                  complete: function(data) {
                    mediaCounts.push(data);
                    callback();
                  }
                });            
            });
          });
          
          // Now we have an array of functions, each containing an async task
          // Execute all async tasks in the asyncTasks array
          async.parallel(asyncTasks, function(err){
            // All tasks are done now
            if (err) return err;
            return res.json({users: mediaCounts});        
          });
        }
      });   
    }
  });
});

var instaArr = [];
var count = 0; 
/* method to get the number of likes per month */
app.get('/likeCounts', ensureAuthenticatedInstagram, function(req, res) {
  var query = models.User.where({ ig_id: req.user.ig_id });

  var render = function() {
    var results = getMonthlyLikes(instaArr);
   // console.log(results);
   // res.render('likeCounts', {photos: instaArr});
    return res.json({counts: results});
  }

  query.findOne(function (err, user) {
    if (err) return err; // user did not exist
    if (user) { // user exists
      // request most recent posts
      Instagram.users.recent( {
        user_id: req.user.ig_id,
        access_token: user.ig_access_token,
        
        complete: function(data, pagination) {
          
          // Function: getPage()
          var getPage = function(currentURL, cb) {
            request({
              uri: currentURL,
              method: "GET"
            }, function (error, response, body) {
              convertJSON = JSON.parse(body);
              jsonData = convertJSON.data; 
              
              // Add new data
              for (var i = 0; i < jsonData.length; i++) {
                tempJSON = {};
                tempJSON.url = jsonData[i].images.low_resolution.url;
                tempJSON.createdTime = jsonData[i].created_time;
                if (jsonData[i].likes != null) {
                  tempJSON.numLikes = jsonData[i].likes.count;
                  tempJSON.likers = jsonData[i].likes.data;
                }
                instaArr.unshift(tempJSON);
              }

              // check if 
              if (currentURL != convertJSON.pagination.next_url 
                && convertJSON.pagination.next_url != null) {
                getPage(convertJSON.pagination.next_url, cb);
              }
              else cb();
            });
          }
          for (var i = 0; i < data.length; i++) {
            tempJSON = {};
            tempJSON.url = data[i].images.low_resolution.url;
            tempJSON.createdTime = data[i].created_time;
            if (data[i].likes != null) {
              tempJSON.numLikes = data[i].likes.count;
              tempJSON.likers = data[i].likes.data;
            }
            instaArr.unshift(tempJSON);
          }
          getPage(pagination.next_url, render);
        }
      });
    }
  });
});


function getMonthlyLikes(arr) {
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                "Sep", "Oct", "Nov", "Dec"];
  var resultArray = [];
  tempJSON = {};
  var prev = null, current = null;
  var monthlyPosts = 0, monthlyLikes = 0;
  for (var i = 0; i < arr.length; i++) {
    current = new Date(arr[i].createdTime * 1000);
    
    // month has not changed yet. Keep adding to posts and likes
    if ((prev == null && current != null) || (current != null && 
        prev.getMonth() == current.getMonth() && 
        prev.getFullYear() == current.getFullYear())) {
      monthlyPosts++;
      monthlyLikes += arr[i].numLikes;
      prev = current;
    }

    // month has changed. Need to push results to array
    else {
      if (current != null && prev != null) {
        tempJSON.monthlyPosts = monthlyPosts;
        tempJSON.monthlyLikes = monthlyLikes;
        tempJSON.monthlyAverage = monthlyLikes * 1.0 / monthlyPosts;
        tempJSON.month = months[prev.getMonth()];
        tempJSON.year = prev.getFullYear();
        resultArray.push(tempJSON);

        // reset posts and number of likes
        tempJSON = {};
        monthlyPosts = 1;
        monthlyLikes = arr[i].numLikes;
        prev = current;
      }
    }
  }
  return resultArray;
}
app.get('/visualization', ensureAuthenticatedInstagram, function (req, res){
  res.render('visualization');
}); 


app.get('/c3visualization', ensureAuthenticatedInstagram, function (req, res){
  res.render('c3visualization');
}); 

app.get('/auth/instagram',
  passport.authenticate('instagram'),
  function(req, res){
    // The request will be redirected to Instagram for authentication, so this
    // function will not be called.
  });

app.get('/auth/instagram/callback', 
  passport.authenticate('instagram', { failureRedirect: '/login'}),
  function(req, res) {
    res.redirect('/account');
  });

app.get('/logout', function(req, res){
  req.logout();
  res.redirect('/');
});

http.createServer(app).listen(app.get('port'), function() {
    console.log('Express server listening on port ' + app.get('port'));
});
