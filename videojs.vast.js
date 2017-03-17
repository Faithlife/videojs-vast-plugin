(function(window, vjs, vast) {
  'use strict';

  var extend = function(obj) {
    var arg, i, k;
    for (i = 1; i < arguments.length; i++) {
      arg = arguments[i];
      for (k in arg) {
        if (arg.hasOwnProperty(k)) {
          obj[k] = arg[k];
        }
      }
    }
    return obj;
  },

  defaults = {
    // seconds before skip button shows, negative values to disable skip button altogether
    skip: 5
  },

  Vast = function (player, settings) {
    var vastClientOptions = {};

    if (settings.convertVast1 && settings.convertXSLUrl) {
      vastClientOptions.urlhandler = (function(xsdUrl) {
        return {
          get: function(url, options, cb) {
            try {
              var xsdXHR = new window.XMLHttpRequest();
              xsdXHR.open('GET', xsdUrl, true);
              xsdXHR.overrideMimeType('text/xml');
              xsdXHR.timeout = options.timeout || 0;
              xsdXHR.withCredentials = options.withCredentials || false;
              xsdXHR.onreadystatechange = function() {
                if (xsdXHR.readyState === 4 && xsdXHR.status === 200 && xsdXHR.responseXML) {
                  var xslStylesheet = xsdXHR.responseXML;
                  var vastXHR = new window.XMLHttpRequest();
                  vastXHR.open('GET', url, true);
                  vastXHR.overrideMimeType('text/xml');
                  vastXHR.timeout = options.timeout || 0;
                  vastXHR.withCredentials = options.withCredentials || false;
                  vastXHR.onreadystatechange = function() {
                    if (vastXHR.readyState === 4 && vastXHR.status === 200 && vastXHR.responseXML) {
                      var vastXml = vastXHR.responseXML;
                      var xsltProcessor = new XSLTProcessor();
                      xsltProcessor.importStylesheet(xslStylesheet);

                      var vastConverted = xsltProcessor.transformToDocument(vastXml);
                      cb(null, vastConverted);
                    }
                  };
                  vastXHR.send();
                }
              };
              xsdXHR.send();
            } catch (err) {
              cb(err);
            }
          },
          supported: function() {
            return true;
          }
        };
      })(settings.convertXSLUrl);
    }

    // return vast plugin
    return {
      createSourceObjects: function (media_files) {
        var sourcesByFormat = {}, i, j, tech;
        var techOrder = player.options().techOrder;
        for (i = 0, j = techOrder.length; i < j; i++) {
          var techName = techOrder[i].charAt(0).toUpperCase() + techOrder[i].slice(1);
          tech = window.videojs.getTech(techName);

          // Check if the current tech is defined before continuing
          if (!tech) {
            continue;
          }
          // Check if the browser supports this technology
          if (tech.isSupported()) {
            // Loop through each source object
            for (var a = 0, b = media_files.length; a < b; a++) {
              var media_file = media_files[a];
              var mimeType = media_file.mimeType;
              if (!tech.canPlayType(mimeType) && /\/x-/.test(mimeType)) {
                mimeType = mimeType.replace('x-', '');
              }
              var source = {type:mimeType, src:media_file.fileURL};
              // Check if source can be played with this technology
              if (tech.canPlaySource(source)) {
                if (sourcesByFormat[techOrder[i]] === undefined) {
                  sourcesByFormat[techOrder[i]] = [];
                }
                sourcesByFormat[techOrder[i]].push({
                  type:mimeType,
                  src: media_file.fileURL,
                  width: media_file.width,
                  height: media_file.height
                });
              }
            }
          }
        }
        // Create sources in preferred format order
        var sources = [];
        for (j = 0; j < techOrder.length; j++) {
          tech = techOrder[j];
          if (sourcesByFormat[tech] !== undefined) {
            for (i = 0; i < sourcesByFormat[tech].length; i++) {
              sources.push(sourcesByFormat[tech][i]);
            }
          }
        }
        return sources;
      },

      getContent: function () {

        vast.client.get(settings.url, vastClientOptions, function(response) {
          if (response) {
            var otherAds = [];
            for (var adIdx = 0; adIdx < response.ads.length; adIdx++) {
              var ad = response.ads[adIdx];
              var currentAd = {};

              if (settings.preRollId && settings.preRollId === ad.id) {
                player.vast.preRoll = currentAd;
              } else if (settings.postRollId && settings.postRollId === ad.id) {
                player.vast.postRoll = currentAd;
              } else {
                otherAds.push(currentAd);
              }

              for (var creaIdx = 0; creaIdx < ad.creatives.length; creaIdx++) {
                var creative = ad.creatives[creaIdx], foundCreative = false, foundCompanion = false;

                if (creative.type === "linear" && !foundCreative) {
                  if (creative.mediaFiles.length) {
                    currentAd.ad = ad;
                    currentAd.creative = creative;
                    currentAd.sources = player.vast.createSourceObjects(creative.mediaFiles);

                    foundCreative = true;
                  }
                } else if (creative.type === "companion" && !foundCompanion) {
                  currentAd.companion = creative;
                  foundCompanion = true;
                }
              }
            }

            if (!player.vast.preRoll && otherAds && otherAds.length) {
              player.vast.preRoll = otherAds.shift();
            }
          }

          if (!player.vast.preRoll && !player.vast.postRoll) {
            // No pre-roll or post-roll, start video
            player.trigger('adscanceled');
          } else {
            player.trigger('vast-ready');
          }
        });
      },

      setupEvents: function() {
        var errorOccurred = false,

        canplayFn = function() {
          player.vastTracker.load();
        },
        timeupdateFn = function() {
          if (isNaN(player.vastTracker.assetDuration)) {
            player.vastTracker.assetDuration = player.duration();
          }
          player.vastTracker.setProgress(player.currentTime());
        },
        pauseFn = function() {
          player.vastTracker.setPaused(true);
          player.one('adplay', function() {
            player.vastTracker.setPaused(false);
          });
        },
        errorFn = function() {
          // Inform ad server we couldn't play the media file for this ad
          vast.util.track(player.vastTracker.ad.errorURLTemplates, {ERRORCODE: 405});
          errorOccurred = true;
          player.trigger('adserror');
        };

        player.on('adcanplay', canplayFn);
        player.on('adtimeupdate', timeupdateFn);
        player.on('adpause', pauseFn);
        player.on('aderror', errorFn);

        player.one('vast-ad-removed', function() {
          player.off('adcanplay', canplayFn);
          player.off('adtimeupdate', timeupdateFn);
          player.off('adpause', pauseFn);
          player.off('aderror', errorFn);
          if (!errorOccurred) {
            player.vastTracker.complete();
          }
        });
      },

      playAd: function(ad) {
        player.ads.startLinearAdMode();
        player.vast.showControls = player.controls();
        if (player.vast.showControls) {
          player.controls(false);
        }

        // Load the Ad configuration
        player.vastTracker = new vast.tracker(ad.ad, ad.creative);
        player.vast.companion = ad.creative;
        player.src(ad.sources);

        var clickthrough;
        if (player.vastTracker.clickThroughURLTemplate) {
          clickthrough = vast.util.resolveURLTemplates(
            [player.vastTracker.clickThroughURLTemplate],
            {
              CACHEBUSTER: Math.round(Math.random() * 1.0e+10),
              CONTENTPLAYHEAD: player.vastTracker.progressFormated()
            }
          )[0];
        }
        var blocker = window.document.createElement("a");
        blocker.className = "vast-blocker";
        blocker.href = clickthrough || "#";
        blocker.target = "_blank";
        blocker.onclick = function() {
          if (player.paused()) {
            player.play();
            return false;
          }
          var clicktrackers = player.vastTracker.clickTrackingURLTemplate;
          if (clicktrackers) {
            player.vastTracker.trackURLs([clicktrackers]);
          }
          player.trigger("ads-click");
        };
        player.vast.blocker = blocker;
        player.el().insertBefore(blocker, player.controlBar.el());

        var skipButton = window.document.createElement("div");
        skipButton.className = "vast-skip-button";
        if (settings.skip < 0) {
          skipButton.style.display = "none";
        }
        player.vast.skipButton = skipButton;
        player.el().appendChild(skipButton);

        player.on("adtimeupdate", player.vast.timeupdate);

        skipButton.onclick = function(e) {
          if((' ' + player.vast.skipButton.className + ' ').indexOf(' enabled ') >= 0) {
            player.vastTracker.skip();
            player.vast.tearDown();
          }
          if(window.Event.prototype.stopPropagation !== undefined) {
            e.stopPropagation();
          } else {
            return false;
          }
        };

        player.vast.setupEvents();

        player.one('adended', player.vast.tearDown);

        player.trigger('vast-ad-ready');
      },

      tearDown: function() {
        // remove ad buttons
        player.vast.skipButton.parentNode.removeChild(player.vast.skipButton);
        player.vast.blocker.parentNode.removeChild(player.vast.blocker);

        // remove vast-specific events
        player.off('adtimeupdate', player.vast.timeupdate);
        player.off('adended', player.vast.tearDown);

        // end ad mode
        player.ads.endLinearAdMode();

        // show player controls for video
        if (player.vast.showControls) {
          player.controls(true);
        }

        player.trigger('vast-ad-removed');
      },

      timeupdate: function(e) {
        player.loadingSpinner.el().style.display = "none";
        var timeLeft = Math.ceil(settings.skip - player.currentTime());
        if(timeLeft > 0) {
          player.vast.skipButton.innerHTML = "Skip in " + timeLeft + "...";
        } else {
          if((' ' + player.vast.skipButton.className + ' ').indexOf(' enabled ') === -1) {
            player.vast.skipButton.className += " enabled";
            player.vast.skipButton.innerHTML = "Skip";
          }
        }
      }
    };

  },

  vastPlugin = function(options) {
    var player = this;
    var settings = extend({}, defaults, options || {});

    // check that we have the ads plugin
    if (player.ads === undefined) {
      window.console.error('vast video plugin requires videojs-contrib-ads, vast plugin not initialized');
      return null;
    }

    // set up vast plugin, then set up events here
    player.vast = new Vast(player, settings);

    player.on('vast-ready', function () {
      // vast is prepared with content, set up ads and trigger ready function
      player.trigger('adsready');
    });

    player.on('vast-ad-ready', function () {
      // start playing ad, note: this should happen this way no matter what, even if autoplay
      // has been disabled since the playAd function shouldn't run until the user/autoplay has
      // caused the main video to trigger the playAd function
      player.play();
    });

    player.on('vast-ad-removed', function () {
      // ad done or removed, start playing the actual video
      player.play();
    });

    player.on('contentupdate', function() {
      // videojs-ads triggers this when src changes
      player.vast.getContent(settings.url);
    });

    player.on('readyforpreroll', function() {
      // if we don't have a vast url, just bail out
      if (!settings.url) {
        player.trigger('adscanceled');
        return null;
      }
      // Check if there are no pre-roll ads
      if (!player.vast.preRoll) {
        player.trigger('nopreroll')
      } else {
        player.vast.playAd(player.vast.preRoll);
      }
    });

    player.on('contentended', function() {
      if (!player.vast.postRoll) {
        player.trigger('nopostroll');
      } else {
        player.vast.playAd(player.vast.postRoll);
      }
    });

    // make an ads request immediately so we're ready when the viewer hits "play"
    if (player.currentSrc()) {
      player.vast.getContent(settings.url);
    }

    // return player to allow this plugin to be chained
    return player;
  };

  vjs.plugin('vast', vastPlugin);

}(window, videojs, DMVAST));
