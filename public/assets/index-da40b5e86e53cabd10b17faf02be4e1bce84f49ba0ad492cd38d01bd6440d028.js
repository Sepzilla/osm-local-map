

























$(function () {
  const map = new L.OSM.Map("map", {
    zoomControl: false,
    layerControl: false,
    contextmenu: true,
    worldCopyJump: true
  });

  OSM.loadSidebarContent = function (path, callback) {
    let content_path = path;

    map.setSidebarOverlaid(false);

    $("#sidebar_loader").prop("hidden", false).addClass("delayed-fade-in");

    // Prevent caching the XHR response as a full-page URL
    // https://github.com/openstreetmap/openstreetmap-website/issues/5663
    if (content_path.indexOf("?") >= 0) {
      content_path += "&xhr=1";
    } else {
      content_path += "?xhr=1";
    }

    $("#sidebar_content")
      .empty();

    fetch(content_path, { headers: { "accept": "text/html", "x-requested-with": "XMLHttpRequest" } })
      .then(response => {
        $("#flash").empty();
        $("#sidebar_loader").removeClass("delayed-fade-in").prop("hidden", true);

        const title = response.headers.get("X-Page-Title");
        if (title) document.title = decodeURIComponent(title);

        return response.text();
      })
      .then(html => {
        const content = $(html);

        $("head")
          .find("link[type=\"application/atom+xml\"]")
          .remove();

        $("head")
          .append(content.filter("link[type=\"application/atom+xml\"]"));

        $("#sidebar_content").html(content.not("link[type=\"application/atom+xml\"]"));

        if (callback) {
          callback();
        }
      });
  };

  const token = $("head").data("oauthToken");
  if (token) OSM.oauth = { authorization: "Bearer " + token };

  const params = OSM.mapParams();

  map.attributionControl.setPrefix("");

  map.updateLayers(params.layers);

  map.on("baselayerchange", function (e) {
    if (map.getZoom() > e.layer.options.maxZoom) {
      map.setView(map.getCenter(), e.layer.options.maxZoom, { reset: true });
    }
  });

  const sidebar = L.OSM.sidebar("#map-ui")
    .addTo(map);

  const position = $("html").attr("dir") === "rtl" ? "topleft" : "topright";

  function addControlGroup(controls) {
    for (const control of controls) control.addTo(map);

    const firstContainer = controls[0].getContainer();
    $(firstContainer).find(".control-button").first()
      .addClass("control-button-first");

    const lastContainer = controls[controls.length - 1].getContainer();
    $(lastContainer).find(".control-button").last()
      .addClass("control-button-last");
  }

  addControlGroup([
    L.OSM.zoom({ position: position }),
    L.OSM.locate({ position: position })
  ]);

  addControlGroup([
    L.OSM.layers({
      position: position,
      layers: map.baseLayers,
      sidebar: sidebar
    }),
    L.OSM.key({
      position: position,
      sidebar: sidebar
    }),
    L.OSM.share({
      "position": position,
      "sidebar": sidebar,
      "short": true
    })
  ]);

  addControlGroup([
    L.OSM.note({
      position: position,
      sidebar: sidebar
    })
  ]);

  addControlGroup([
    L.OSM.query({
      position: position,
      sidebar: sidebar
    })
  ]);

  L.control.scale()
    .addTo(map);

  OSM.initializeContextMenu(map);

  if (OSM.STATUS !== "api_offline" && OSM.STATUS !== "database_offline") {
    OSM.initializeNotesLayer(map);
    if (params.layers.indexOf(map.noteLayer.options.code) >= 0) {
      map.addLayer(map.noteLayer);
    }

    OSM.initializeDataLayer(map);
    if (params.layers.indexOf(map.dataLayer.options.code) >= 0) {
      map.addLayer(map.dataLayer);
    }

    if (params.layers.indexOf(map.gpsLayer.options.code) >= 0) {
      map.addLayer(map.gpsLayer);
    }
  }

  $(".leaflet-control .control-button").tooltip({ placement: "left", container: "body" });

  const expiry = new Date();
  expiry.setYear(expiry.getFullYear() + 10);

  map.on("moveend baselayerchange overlayadd overlayremove", function () {
    updateLinks(
      map.getCenter().wrap(),
      map.getZoom(),
      map.getLayersCode(),
      map._object);

    Cookies.set("_osm_location", OSM.locationCookie(map), { secure: true, expires: expiry, path: "/", samesite: "lax" });
  });

  if (Cookies.get("_osm_welcome") !== "hide") {
    $(".welcome").removeAttr("hidden");
  }

  $(".welcome .btn-close").on("click", function () {
    $(".welcome").hide();
    Cookies.set("_osm_welcome", "hide", { secure: true, expires: expiry, path: "/", samesite: "lax" });
  });

  const bannerExpiry = new Date();
  bannerExpiry.setYear(bannerExpiry.getFullYear() + 1);

  $("#banner .btn-close").on("click", function (e) {
    const cookieId = e.target.id;
    $("#banner").hide();
    e.preventDefault();
    if (cookieId) {
      Cookies.set(cookieId, "hide", { secure: true, expires: bannerExpiry, path: "/", samesite: "lax" });
    }
  });

  if (OSM.MATOMO) {
    map.on("baselayerchange overlayadd", function (e) {
      if (e.layer.options) {
        const goal = OSM.MATOMO.goals[e.layer.options.layerId];

        if (goal) {
          $("body").trigger("matomogoal", goal);
        }
      }
    });
  }

  if (params.bounds) {
    map.fitBounds(params.bounds);
  } else {
    map.setView([params.lat, params.lon], params.zoom);
  }

  if (params.marker) {
    L.marker([params.mlat, params.mlon]).addTo(map);
  }

  function remoteEditHandler(bbox, object) {
    const remoteEditHost = "http://127.0.0.1:8111",
          osmHost = location.protocol + "//" + location.host,
          query = new URLSearchParams({
            left: bbox.getWest() - 0.0001,
            top: bbox.getNorth() + 0.0001,
            right: bbox.getEast() + 0.0001,
            bottom: bbox.getSouth() - 0.0001
          });

    if (object && object.type !== "note") query.set("select", object.type + object.id); // can't select notes
    sendRemoteEditCommand(remoteEditHost + "/load_and_zoom?" + query)
      .then(() => {
        if (object && object.type === "note") {
          const noteQuery = new URLSearchParams({ url: osmHost + OSM.apiUrl(object) });
          sendRemoteEditCommand(remoteEditHost + "/import?" + noteQuery);
        }
      })
      .catch(() => {
        // eslint-disable-next-line no-alert
        alert(OSM.i18n.t("site.index.remote_failed"));
      });

    function sendRemoteEditCommand(url) {
      return fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(5000) });
    }

    return false;
  }

  $("a[data-editor=remote]").click(function (e) {
    const params = OSM.mapParams(this.search);
    remoteEditHandler(map.getBounds(), params.object);
    e.preventDefault();
  });

  if (new URLSearchParams(location.search).get("edit_help")) {
    $("#editanchor")
      .removeAttr("title")
      .tooltip({
        placement: "bottom",
        title: OSM.i18n.t("javascripts.edit_help")
      })
      .tooltip("show");

    $("body").one("click", function () {
      $("#editanchor").tooltip("hide");
    });
  }

  OSM.Index = function (map) {
    const page = {};

    page.pushstate = page.popstate = function () {
      map.setSidebarOverlaid(true);
      document.title = OSM.i18n.t("layouts.project_name.title");
    };

    page.load = function () {
      const params = new URLSearchParams(location.search);
      if (params.has("query")) {
        $("#sidebar .search_form input[name=query]").value(params.get("query"));
      }
      if (!("autofocus" in document.createElement("input"))) {
        $("#sidebar .search_form input[name=query]").focus();
      }
      return map.getState();
    };

    return page;
  };

  OSM.Browse = function (map, type) {
    const page = {};

    page.pushstate = page.popstate = function (path, id, version) {
      OSM.loadSidebarContent(path, function () {
        addObject(type, id, version);
      });
    };

    page.load = function (path, id, version) {
      addObject(type, id, version, true);
    };

    function addObject(type, id, version, center) {
      const hashParams = OSM.parseHash();
      map.addObject({ type: type, id: parseInt(id, 10), version: version && parseInt(version, 10) }, function (bounds) {
        if (!hashParams.center && bounds.isValid() &&
            (center || !map.getBounds().contains(bounds))) {
          OSM.router.withoutMoveListener(function () {
            map.fitBounds(bounds);
          });
        }
      });
    }

    page.unload = function () {
      map.removeObject();
    };

    return page;
  };

  OSM.OldBrowse = function () {
    const page = {};

    page.pushstate = page.popstate = function (path) {
      OSM.loadSidebarContent(path);
    };

    return page;
  };

  const history = OSM.History(map);

  OSM.router = OSM.Router(map, {
    "/": OSM.Index(map),
    "/search": OSM.Search(map),
    "/directions": OSM.Directions(map),
    "/export": OSM.Export(map),
    "/note/new": OSM.NewNote(map),
    "/history/friends": history,
    "/history/nearby": history,
    "/history": history,
    "/user/:display_name/history": history,
    "/note/:id": OSM.Note(map),
    "/node/:id(/history)": OSM.Browse(map, "node"),
    "/node/:id/history/:version": OSM.Browse(map, "node"),
    "/way/:id(/history)": OSM.Browse(map, "way"),
    "/way/:id/history/:version": OSM.OldBrowse(),
    "/relation/:id(/history)": OSM.Browse(map, "relation"),
    "/relation/:id/history/:version": OSM.OldBrowse(),
    "/changeset/:id": OSM.Changeset(map),
    "/query": OSM.Query(map),
    "/account/home": OSM.Home(map)
  });

  if (OSM.preferred_editor === "remote" && location.pathname === "/edit") {
    remoteEditHandler(map.getBounds(), params.object);
    OSM.router.setCurrentPath("/");
  }

  OSM.router.load();

  $(document).on("click", "a", function (e) {
    if (e.isDefaultPrevented() || e.isPropagationStopped() || $(e.target).data("turbo")) {
      return;
    }

    // Open links in a new tab as normal.
    if (e.which > 1 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }

    // Open local anchor links as normal.
    if ($(this).attr("href")?.startsWith("#")) {
      return;
    }

    // Ignore cross-protocol and cross-origin links.
    if (location.protocol !== this.protocol || location.host !== this.host) {
      return;
    }

    if (OSM.router.route(this.pathname + this.search + this.hash)) {
      e.preventDefault();
      if (this.pathname !== "/directions") {
        $("header").addClass("closed");
      }
    }
  });

  $(document).on("click", "#sidebar .sidebar-close-controls button", function () {
    OSM.router.route("/" + OSM.formatHash(map));
  });
});
L.OSM.sidebar = function (selector) {
  const control = {},
        sidebar = $(selector);
  let current = $(),
      currentButton = $(),
      map;

  control.addTo = function (_) {
    map = _;
    return control;
  };

  control.addPane = function (pane) {
    pane
      .hide()
      .appendTo(sidebar);
  };

  control.togglePane = function (pane, button) {
    const mediumDeviceWidth = window.getComputedStyle(document.documentElement).getPropertyValue("--bs-breakpoint-md");
    const isMediumDevice = window.matchMedia(`(max-width: ${mediumDeviceWidth})`).matches;
    const paneWidth = 250;

    current
      .hide()
      .trigger("hide");

    currentButton
      .removeClass("active");

    if (current === pane) {
      $(sidebar).hide();
      $("#content").addClass("overlay-right-sidebar");
      current = currentButton = $();
      if (isMediumDevice) {
        map.panBy([0, -$("#map").height() / 2], { animate: false });
      } else if ($("html").attr("dir") === "rtl") {
        map.panBy([-paneWidth, 0], { animate: false });
      }
    } else {
      $(sidebar).show();
      $("#content").removeClass("overlay-right-sidebar");
      current = pane;
      currentButton = button || $();
      if (isMediumDevice) {
        map.panBy([0, $("#map").height()], { animate: false });
      } else if ($("html").attr("dir") === "rtl") {
        map.panBy([paneWidth, 0], { animate: false });
      }
    }

    map.invalidateSize({ pan: false, animate: false });

    current
      .show()
      .trigger("show");

    currentButton
      .addClass("active");
  };

  sidebar.find(".sidebar-close-controls button").on("click", () => {
    control.togglePane(current, currentButton);
  });

  return control;
};
L.OSM.sidebarPane = function (options, uiClass, buttonTitle, paneTitle) {
  const control = L.control(options);

  control.onAdd = function (map) {
    const $container = $("<div>")
      .attr("class", "control-" + uiClass);

    const button = $("<a>")
      .attr("class", "control-button")
      .attr("href", "#")
      .html("<span class=\"icon " + uiClass + "\"></span>")
      .on("click", toggle);

    if (buttonTitle) {
      button.attr("title", OSM.i18n.t(buttonTitle));
    }

    button.appendTo($container);

    const $ui = $("<div>")
      .attr("class", `${uiClass}-ui position-relative z-n1`);

    $("<h2 class='p-3 pb-0 pe-5 text-break'>")
      .text(OSM.i18n.t(paneTitle))
      .appendTo($ui);

    options.sidebar.addPane($ui);

    this.onAddPane(map, button, $ui, toggle);

    function toggle(e) {
      e.stopPropagation();
      e.preventDefault();
      if (!button.hasClass("disabled")) {
        options.sidebar.togglePane($ui, button);
      }
      $(".leaflet-control .control-button").tooltip("hide");
    }

    return $container[0];
  };

  // control.onAddPane = function (map, button, $ui, toggle) {
  // }

  return control;
};
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('leaflet')) :
  typeof define === 'function' && define.amd ? define(['exports', 'leaflet'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory((global.L = global.L || {}, global.L.Control = global.L.Control || {}, global.L.Control.Locate = {}), global.L));
})(this, (function (exports, leaflet) { 'use strict';

  /*!
  Copyright (c) 2016 Dominik Moritz

  This file is part of the leaflet locate control. It is licensed under the MIT license.
  You can find the project at: https://github.com/domoritz/leaflet-locatecontrol
  */
  const addClasses = (el, names) => {
    names.split(" ").forEach((className) => {
      el.classList.add(className);
    });
  };

  const removeClasses = (el, names) => {
    names.split(" ").forEach((className) => {
      el.classList.remove(className);
    });
  };

  /**
   * Compatible with Circle but a true marker instead of a path
   */
  const LocationMarker = leaflet.Marker.extend({
    initialize(latlng, options) {
      leaflet.setOptions(this, options);
      this._latlng = latlng;
      this.createIcon();
    },

    /**
     * Create a styled circle location marker
     */
    createIcon() {
      const opt = this.options;

      let style = "";

      if (opt.color !== undefined) {
        style += `stroke:${opt.color};`;
      }
      if (opt.weight !== undefined) {
        style += `stroke-width:${opt.weight};`;
      }
      if (opt.fillColor !== undefined) {
        style += `fill:${opt.fillColor};`;
      }
      if (opt.fillOpacity !== undefined) {
        style += `fill-opacity:${opt.fillOpacity};`;
      }
      if (opt.opacity !== undefined) {
        style += `opacity:${opt.opacity};`;
      }

      const icon = this._getIconSVG(opt, style);

      this._locationIcon = leaflet.divIcon({
        className: icon.className,
        html: icon.svg,
        iconSize: [icon.w, icon.h]
      });

      this.setIcon(this._locationIcon);
    },

    /**
     * Return the raw svg for the shape
     *
     * Split so can be easily overridden
     */
    _getIconSVG(options, style) {
      const r = options.radius;
      const w = options.weight;
      const s = r + w;
      const s2 = s * 2;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${s2}" height="${s2}" version="1.1" viewBox="-${s} -${s} ${s2} ${s2}">` +
        '<circle r="' +
        r +
        '" style="' +
        style +
        '" />' +
        "</svg>";
      return {
        className: "leaflet-control-locate-location",
        svg,
        w: s2,
        h: s2
      };
    },

    setStyle(style) {
      leaflet.setOptions(this, style);
      this.createIcon();
    }
  });

  const CompassMarker = LocationMarker.extend({
    initialize(latlng, heading, options) {
      leaflet.setOptions(this, options);
      this._latlng = latlng;
      this._heading = heading;
      this.createIcon();
    },

    setHeading(heading) {
      this._heading = heading;
    },

    /**
     * Create a styled arrow compass marker
     */
    _getIconSVG(options, style) {
      const r = options.radius;
      const w = options.width + options.weight;
      const h = (r + options.depth + options.weight) * 2;
      const path = `M0,0 l${options.width / 2},${options.depth} l-${w},0 z`;
      const svgstyle = `transform: rotate(${this._heading}deg)`;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" version="1.1" viewBox="-${w / 2} 0 ${w} ${h}" style="${svgstyle}">` +
        '<path d="' +
        path +
        '" style="' +
        style +
        '" />' +
        "</svg>";
      return {
        className: "leaflet-control-locate-heading",
        svg,
        w,
        h
      };
    }
  });

  const LocateControl = leaflet.Control.extend({
    options: {
      /** Position of the control */
      position: "topleft",
      /** The layer that the user's location should be drawn on. By default creates a new layer. */
      layer: undefined,
      /**
       * Automatically sets the map view (zoom and pan) to the user's location as it updates.
       * While the map is following the user's location, the control is in the `following` state,
       * which changes the style of the control and the circle marker.
       *
       * Possible values:
       *  - false: never updates the map view when location changes.
       *  - 'once': set the view when the location is first determined
       *  - 'always': always updates the map view when location changes.
       *              The map view follows the user's location.
       *  - 'untilPan': like 'always', except stops updating the
       *                view if the user has manually panned the map.
       *                The map view follows the user's location until she pans.
       *  - 'untilPanOrZoom': (default) like 'always', except stops updating the
       *                view if the user has manually panned the map.
       *                The map view follows the user's location until she pans.
       */
      setView: "untilPanOrZoom",
      /** Keep the current map zoom level when setting the view and only pan. */
      keepCurrentZoomLevel: false,
      /** After activating the plugin by clicking on the icon, zoom to the selected zoom level, even when keepCurrentZoomLevel is true. Set to 'false' to disable this feature. */
      initialZoomLevel: false,
      /**
       * This callback can be used to override the viewport tracking
       * This function should return a LatLngBounds object.
       *
       * For example to extend the viewport to ensure that a particular LatLng is visible:
       *
       * getLocationBounds: function(locationEvent) {
       *    return locationEvent.bounds.extend([-33.873085, 151.219273]);
       * },
       */
      getLocationBounds(locationEvent) {
        return locationEvent.bounds;
      },
      /** Smooth pan and zoom to the location of the marker. Only works in Leaflet 1.0+. */
      flyTo: false,
      /**
       * The user location can be inside and outside the current view when the user clicks on the
       * control that is already active. Both cases can be configures separately.
       * Possible values are:
       *  - 'setView': zoom and pan to the current location
       *  - 'stop': stop locating and remove the location marker
       */
      clickBehavior: {
        /** What should happen if the user clicks on the control while the location is within the current view. */
        inView: "stop",
        /** What should happen if the user clicks on the control while the location is outside the current view. */
        outOfView: "setView",
        /**
         * What should happen if the user clicks on the control while the location is within the current view
         * and we could be following but are not. Defaults to a special value which inherits from 'inView';
         */
        inViewNotFollowing: "inView"
      },
      /**
       * If set, save the map bounds just before centering to the user's
       * location. When control is disabled, set the view back to the
       * bounds that were saved.
       */
      returnToPrevBounds: false,
      /**
       * Keep a cache of the location after the user deactivates the control. If set to false, the user has to wait
       * until the locate API returns a new location before they see where they are again.
       */
      cacheLocation: true,
      /** If set, a circle that shows the location accuracy is drawn. */
      drawCircle: true,
      /** If set, the marker at the users' location is drawn. */
      drawMarker: true,
      /** If set and supported then show the compass heading */
      showCompass: true,
      /** The class to be used to create the marker. For example L.CircleMarker or L.Marker */
      markerClass: LocationMarker,
      /** The class us be used to create the compass bearing arrow */
      compassClass: CompassMarker,
      /** Accuracy circle style properties. NOTE these styles should match the css animations styles */
      circleStyle: {
        className: "leaflet-control-locate-circle",
        color: "#136AEC",
        fillColor: "#136AEC",
        fillOpacity: 0.15,
        weight: 0
      },
      /** Inner marker style properties. Only works if your marker class supports `setStyle`. */
      markerStyle: {
        className: "leaflet-control-locate-marker",
        color: "#fff",
        fillColor: "#2A93EE",
        fillOpacity: 1,
        weight: 3,
        opacity: 1,
        radius: 9
      },
      /** Compass */
      compassStyle: {
        fillColor: "#2A93EE",
        fillOpacity: 1,
        weight: 0,
        color: "#fff",
        opacity: 1,
        radius: 9, // How far is the arrow from the center of the marker
        width: 9, // Width of the arrow
        depth: 6 // Length of the arrow
      },
      /**
       * Changes to accuracy circle and inner marker while following.
       * It is only necessary to provide the properties that should change.
       */
      followCircleStyle: {},
      followMarkerStyle: {
        // color: '#FFA500',
        // fillColor: '#FFB000'
      },
      followCompassStyle: {},
      /** The CSS class for the icon. For example fa-location-arrow or fa-map-marker */
      icon: "leaflet-control-locate-location-arrow",
      iconLoading: "leaflet-control-locate-spinner",
      /** The element to be created for icons. For example span or i */
      iconElementTag: "span",
      /** The element to be created for the text. For example small or span */
      textElementTag: "small",
      /** Padding around the accuracy circle. */
      circlePadding: [0, 0],
      /** Use metric units. */
      metric: true,
      /**
       * This callback can be used in case you would like to override button creation behavior.
       * This is useful for DOM manipulation frameworks such as angular etc.
       * This function should return an object with HtmlElement for the button (link property) and the icon (icon property).
       */
      createButtonCallback(container, options) {
        const link = leaflet.DomUtil.create("a", "leaflet-bar-part leaflet-bar-part-single", container);
        link.title = options.strings.title;
        link.href = "#";
        link.setAttribute("role", "button");
        const icon = leaflet.DomUtil.create(options.iconElementTag, options.icon, link);

        if (options.strings.text !== undefined) {
          const text = leaflet.DomUtil.create(options.textElementTag, "leaflet-locate-text", link);
          text.textContent = options.strings.text;
          link.classList.add("leaflet-locate-text-active");
          link.parentNode.style.display = "flex";
          if (options.icon.length > 0) {
            icon.classList.add("leaflet-locate-icon");
          }
        }

        return { link, icon };
      },
      /** This event is called in case of any location error that is not a time out error. */
      onLocationError(err, control) {
        alert(err.message);
      },
      /**
       * This event is called when the user's location is outside the bounds set on the map.
       * The event is called repeatedly when the location changes.
       */
      onLocationOutsideMapBounds(control) {
        control.stop();
        alert(control.options.strings.outsideMapBoundsMsg);
      },
      /** Display a pop-up when the user click on the inner marker. */
      showPopup: true,
      strings: {
        title: "Show me where I am",
        metersUnit: "meters",
        feetUnit: "feet",
        popup: "You are within {distance} {unit} from this point",
        outsideMapBoundsMsg: "You seem located outside the boundaries of the map"
      },
      /** The default options passed to leaflets locate method. */
      locateOptions: {
        maxZoom: Infinity,
        watch: true, // if you overwrite this, visualization cannot be updated
        setView: false // have to set this to false because we have to
        // do setView manually
      }
    },

    initialize(options) {
      // set default options if nothing is set (merge one step deep)
      for (const i in options) {
        if (typeof this.options[i] === "object") {
          leaflet.extend(this.options[i], options[i]);
        } else {
          this.options[i] = options[i];
        }
      }

      // extend the follow marker style and circle from the normal style
      this.options.followMarkerStyle = leaflet.extend({}, this.options.markerStyle, this.options.followMarkerStyle);
      this.options.followCircleStyle = leaflet.extend({}, this.options.circleStyle, this.options.followCircleStyle);
      this.options.followCompassStyle = leaflet.extend({}, this.options.compassStyle, this.options.followCompassStyle);
    },

    /**
     * Add control to map. Returns the container for the control.
     */
    onAdd(map) {
      const container = leaflet.DomUtil.create("div", "leaflet-control-locate leaflet-bar leaflet-control");
      this._container = container;
      this._map = map;
      this._layer = this.options.layer || new leaflet.LayerGroup();
      this._layer.addTo(map);
      this._event = undefined;
      this._compassHeading = null;
      this._prevBounds = null;

      const linkAndIcon = this.options.createButtonCallback(container, this.options);
      this._link = linkAndIcon.link;
      this._icon = linkAndIcon.icon;

      leaflet.DomEvent.on(
        this._link,
        "click",
        function (ev) {
          leaflet.DomEvent.stopPropagation(ev);
          leaflet.DomEvent.preventDefault(ev);
          this._onClick();
        },
        this
      ).on(this._link, "dblclick", leaflet.DomEvent.stopPropagation);

      this._resetVariables();

      this._map.on("unload", this._unload, this);

      return container;
    },

    /**
     * This method is called when the user clicks on the control.
     */
    _onClick() {
      this._justClicked = true;
      const wasFollowing = this._isFollowing();
      this._userPanned = false;
      this._userZoomed = false;

      if (this._active && !this._event) {
        // click while requesting
        this.stop();
      } else if (this._active) {
        const behaviors = this.options.clickBehavior;
        let behavior = behaviors.outOfView;
        if (this._map.getBounds().contains(this._event.latlng)) {
          behavior = wasFollowing ? behaviors.inView : behaviors.inViewNotFollowing;
        }

        // Allow inheriting from another behavior
        if (behaviors[behavior]) {
          behavior = behaviors[behavior];
        }

        switch (behavior) {
          case "setView":
            this.setView();
            break;
          case "stop":
            this.stop();
            if (this.options.returnToPrevBounds) {
              const f = this.options.flyTo ? this._map.flyToBounds : this._map.fitBounds;
              f.bind(this._map)(this._prevBounds);
            }
            break;
        }
      } else {
        if (this.options.returnToPrevBounds) {
          this._prevBounds = this._map.getBounds();
        }
        this.start();
      }

      this._updateContainerStyle();
    },

    /**
     * Starts the plugin:
     * - activates the engine
     * - draws the marker (if coordinates available)
     */
    start() {
      this._activate();

      if (this._event) {
        this._drawMarker(this._map);

        // if we already have a location but the user clicked on the control
        if (this.options.setView) {
          this.setView();
        }
      }
      this._updateContainerStyle();
    },

    /**
     * Stops the plugin:
     * - deactivates the engine
     * - reinitializes the button
     * - removes the marker
     */
    stop() {
      this._deactivate();

      this._cleanClasses();
      this._resetVariables();

      this._removeMarker();
    },

    /**
     * Keep the control active but stop following the location
     */
    stopFollowing() {
      this._userPanned = true;
      this._updateContainerStyle();
      this._drawMarker();
    },

    /**
     * This method launches the location engine.
     * It is called before the marker is updated,
     * event if it does not mean that the event will be ready.
     *
     * Override it if you want to add more functionalities.
     * It should set the this._active to true and do nothing if
     * this._active is true.
     */
    _activate() {
      if (this._active || !this._map) {
        return;
      }

      this._map.locate(this.options.locateOptions);
      this._map.fire("locateactivate", this);
      this._active = true;

      // bind event listeners
      this._map.on("locationfound", this._onLocationFound, this);
      this._map.on("locationerror", this._onLocationError, this);
      this._map.on("dragstart", this._onDrag, this);
      this._map.on("zoomstart", this._onZoom, this);
      this._map.on("zoomend", this._onZoomEnd, this);
      if (this.options.showCompass) {
        const oriAbs = "ondeviceorientationabsolute" in window;
        if (oriAbs || "ondeviceorientation" in window) {
          const _this = this;
          const deviceorientation = function () {
            leaflet.DomEvent.on(window, oriAbs ? "deviceorientationabsolute" : "deviceorientation", _this._onDeviceOrientation, _this);
          };
          if (DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
            DeviceOrientationEvent.requestPermission().then(function (permissionState) {
              if (permissionState === "granted") {
                deviceorientation();
              }
            });
          } else {
            deviceorientation();
          }
        }
      }
    },

    /**
     * Called to stop the location engine.
     *
     * Override it to shutdown any functionalities you added on start.
     */
    _deactivate() {
      if (!this._active || !this._map) {
        return;
      }

      this._map.stopLocate();
      this._map.fire("locatedeactivate", this);
      this._active = false;

      if (!this.options.cacheLocation) {
        this._event = undefined;
      }

      // unbind event listeners
      this._map.off("locationfound", this._onLocationFound, this);
      this._map.off("locationerror", this._onLocationError, this);
      this._map.off("dragstart", this._onDrag, this);
      this._map.off("zoomstart", this._onZoom, this);
      this._map.off("zoomend", this._onZoomEnd, this);
      if (this.options.showCompass) {
        this._compassHeading = null;
        if ("ondeviceorientationabsolute" in window) {
          leaflet.DomEvent.off(window, "deviceorientationabsolute", this._onDeviceOrientation, this);
        } else if ("ondeviceorientation" in window) {
          leaflet.DomEvent.off(window, "deviceorientation", this._onDeviceOrientation, this);
        }
      }
    },

    /**
     * Zoom (unless we should keep the zoom level) and an to the current view.
     */
    setView() {
      this._drawMarker();
      if (this._isOutsideMapBounds()) {
        this._event = undefined; // clear the current location so we can get back into the bounds
        this.options.onLocationOutsideMapBounds(this);
      } else {
        if (this._justClicked && this.options.initialZoomLevel !== false) {
          let f = this.options.flyTo ? this._map.flyTo : this._map.setView;
          f.bind(this._map)([this._event.latitude, this._event.longitude], this.options.initialZoomLevel);
        } else if (this.options.keepCurrentZoomLevel) {
          let f = this.options.flyTo ? this._map.flyTo : this._map.panTo;
          f.bind(this._map)([this._event.latitude, this._event.longitude]);
        } else {
          let f = this.options.flyTo ? this._map.flyToBounds : this._map.fitBounds;
          // Ignore zoom events while setting the viewport as these would stop following
          this._ignoreEvent = true;
          f.bind(this._map)(this.options.getLocationBounds(this._event), {
            padding: this.options.circlePadding,
            maxZoom: this.options.initialZoomLevel || this.options.locateOptions.maxZoom
          });
          leaflet.Util.requestAnimFrame(function () {
            // Wait until after the next animFrame because the flyTo can be async
            this._ignoreEvent = false;
          }, this);
        }
      }
    },

    /**
     *
     */
    _drawCompass() {
      if (!this._event) {
        return;
      }

      const latlng = this._event.latlng;

      if (this.options.showCompass && latlng && this._compassHeading !== null) {
        const cStyle = this._isFollowing() ? this.options.followCompassStyle : this.options.compassStyle;
        if (!this._compass) {
          this._compass = new this.options.compassClass(latlng, this._compassHeading, cStyle).addTo(this._layer);
        } else {
          this._compass.setLatLng(latlng);
          this._compass.setHeading(this._compassHeading);
          // If the compassClass can be updated with setStyle, update it.
          if (this._compass.setStyle) {
            this._compass.setStyle(cStyle);
          }
        }
        //
      }
      if (this._compass && (!this.options.showCompass || this._compassHeading === null)) {
        this._compass.removeFrom(this._layer);
        this._compass = null;
      }
    },

    /**
     * Draw the marker and accuracy circle on the map.
     *
     * Uses the event retrieved from onLocationFound from the map.
     */
    _drawMarker() {
      if (this._event.accuracy === undefined) {
        this._event.accuracy = 0;
      }

      const radius = this._event.accuracy;
      const latlng = this._event.latlng;

      // circle with the radius of the location's accuracy
      if (this.options.drawCircle) {
        const style = this._isFollowing() ? this.options.followCircleStyle : this.options.circleStyle;

        if (!this._circle) {
          this._circle = leaflet.circle(latlng, radius, style).addTo(this._layer);
        } else {
          this._circle.setLatLng(latlng).setRadius(radius).setStyle(style);
        }
      }

      let distance;
      let unit;
      if (this.options.metric) {
        distance = radius.toFixed(0);
        unit = this.options.strings.metersUnit;
      } else {
        distance = (radius * 3.2808399).toFixed(0);
        unit = this.options.strings.feetUnit;
      }

      // small inner marker
      if (this.options.drawMarker) {
        const mStyle = this._isFollowing() ? this.options.followMarkerStyle : this.options.markerStyle;
        if (!this._marker) {
          this._marker = new this.options.markerClass(latlng, mStyle).addTo(this._layer);
        } else {
          this._marker.setLatLng(latlng);
          // If the markerClass can be updated with setStyle, update it.
          if (this._marker.setStyle) {
            this._marker.setStyle(mStyle);
          }
        }
      }

      this._drawCompass();

      const t = this.options.strings.popup;
      function getPopupText() {
        if (typeof t === "string") {
          return leaflet.Util.template(t, { distance, unit });
        } else if (typeof t === "function") {
          return t({ distance, unit });
        } else {
          return t;
        }
      }
      if (this.options.showPopup && t && this._marker) {
        this._marker.bindPopup(getPopupText())._popup.setLatLng(latlng);
      }
      if (this.options.showPopup && t && this._compass) {
        this._compass.bindPopup(getPopupText())._popup.setLatLng(latlng);
      }
    },

    /**
     * Remove the marker from map.
     */
    _removeMarker() {
      this._layer.clearLayers();
      this._marker = undefined;
      this._circle = undefined;
    },

    /**
     * Unload the plugin and all event listeners.
     * Kind of the opposite of onAdd.
     */
    _unload() {
      this.stop();
      // May become undefined during HMR
      if (this._map) {
        this._map.off("unload", this._unload, this);
      }
    },

    /**
     * Sets the compass heading
     */
    _setCompassHeading(angle) {
      if (!isNaN(parseFloat(angle)) && isFinite(angle)) {
        angle = Math.round(angle);

        this._compassHeading = angle;
        leaflet.Util.requestAnimFrame(this._drawCompass, this);
      } else {
        this._compassHeading = null;
      }
    },

    /**
     * If the compass fails calibration just fail safely and remove the compass
     */
    _onCompassNeedsCalibration() {
      this._setCompassHeading();
    },

    /**
     * Process and normalise compass events
     */
    _onDeviceOrientation(e) {
      if (!this._active) {
        return;
      }

      if (e.webkitCompassHeading) {
        // iOS
        this._setCompassHeading(e.webkitCompassHeading);
      } else if (e.absolute && e.alpha) {
        // Android
        this._setCompassHeading(360 - e.alpha);
      }
    },

    /**
     * Calls deactivate and dispatches an error.
     */
    _onLocationError(err) {
      // ignore time out error if the location is watched
      if (err.code == 3 && this.options.locateOptions.watch) {
        return;
      }

      this.stop();
      this.options.onLocationError(err, this);
    },

    /**
     * Stores the received event and updates the marker.
     */
    _onLocationFound(e) {
      // no need to do anything if the location has not changed
      if (this._event && this._event.latlng.lat === e.latlng.lat && this._event.latlng.lng === e.latlng.lng && this._event.accuracy === e.accuracy) {
        return;
      }

      if (!this._active) {
        // we may have a stray event
        return;
      }

      this._event = e;

      this._drawMarker();
      this._updateContainerStyle();

      switch (this.options.setView) {
        case "once":
          if (this._justClicked) {
            this.setView();
          }
          break;
        case "untilPan":
          if (!this._userPanned) {
            this.setView();
          }
          break;
        case "untilPanOrZoom":
          if (!this._userPanned && !this._userZoomed) {
            this.setView();
          }
          break;
        case "always":
          this.setView();
          break;
      }

      this._justClicked = false;
    },

    /**
     * When the user drags. Need a separate event so we can bind and unbind event listeners.
     */
    _onDrag() {
      // only react to drags once we have a location
      if (this._event && !this._ignoreEvent) {
        this._userPanned = true;
        this._updateContainerStyle();
        this._drawMarker();
      }
    },

    /**
     * When the user zooms. Need a separate event so we can bind and unbind event listeners.
     */
    _onZoom() {
      // only react to drags once we have a location
      if (this._event && !this._ignoreEvent) {
        this._userZoomed = true;
        this._updateContainerStyle();
        this._drawMarker();
      }
    },

    /**
     * After a zoom ends update the compass and handle sideways zooms
     */
    _onZoomEnd() {
      if (this._event) {
        this._drawCompass();
      }

      if (this._event && !this._ignoreEvent) {
        // If we have zoomed in and out and ended up sideways treat it as a pan
        if (this._marker && !this._map.getBounds().pad(-0.3).contains(this._marker.getLatLng())) {
          this._userPanned = true;
          this._updateContainerStyle();
          this._drawMarker();
        }
      }
    },

    /**
     * Compute whether the map is following the user location with pan and zoom.
     */
    _isFollowing() {
      if (!this._active) {
        return false;
      }

      if (this.options.setView === "always") {
        return true;
      } else if (this.options.setView === "untilPan") {
        return !this._userPanned;
      } else if (this.options.setView === "untilPanOrZoom") {
        return !this._userPanned && !this._userZoomed;
      }
    },

    /**
     * Check if location is in map bounds
     */
    _isOutsideMapBounds() {
      if (this._event === undefined) {
        return false;
      }
      return this._map.options.maxBounds && !this._map.options.maxBounds.contains(this._event.latlng);
    },

    /**
     * Toggles button class between following and active.
     */
    _updateContainerStyle() {
      if (!this._container) {
        return;
      }

      if (this._active && !this._event) {
        // active but don't have a location yet
        this._setClasses("requesting");
      } else if (this._isFollowing()) {
        this._setClasses("following");
      } else if (this._active) {
        this._setClasses("active");
      } else {
        this._cleanClasses();
      }
    },

    /**
     * Sets the CSS classes for the state.
     */
    _setClasses(state) {
      if (state == "requesting") {
        removeClasses(this._container, "active following");
        addClasses(this._container, "requesting");

        removeClasses(this._icon, this.options.icon);
        addClasses(this._icon, this.options.iconLoading);
      } else if (state == "active") {
        removeClasses(this._container, "requesting following");
        addClasses(this._container, "active");

        removeClasses(this._icon, this.options.iconLoading);
        addClasses(this._icon, this.options.icon);
      } else if (state == "following") {
        removeClasses(this._container, "requesting");
        addClasses(this._container, "active following");

        removeClasses(this._icon, this.options.iconLoading);
        addClasses(this._icon, this.options.icon);
      }
    },

    /**
     * Removes all classes from button.
     */
    _cleanClasses() {
      leaflet.DomUtil.removeClass(this._container, "requesting");
      leaflet.DomUtil.removeClass(this._container, "active");
      leaflet.DomUtil.removeClass(this._container, "following");

      removeClasses(this._icon, this.options.iconLoading);
      addClasses(this._icon, this.options.icon);
    },

    /**
     * Reinitializes state variables.
     */
    _resetVariables() {
      // whether locate is active or not
      this._active = false;

      // true if the control was clicked for the first time
      // we need this so we can pan and zoom once we have the location
      this._justClicked = false;

      // true if the user has panned the map after clicking the control
      this._userPanned = false;

      // true if the user has zoomed the map after clicking the control
      this._userZoomed = false;
    }
  });

  function locate(options) {
    return new LocateControl(options);
  }

  exports.CompassMarker = CompassMarker;
  exports.LocateControl = LocateControl;
  exports.LocationMarker = LocationMarker;
  exports.locate = locate;

  Object.defineProperty(exports, '__esModule', { value: true });

}));

            (function() {
              if (typeof window !== 'undefined' && window.L) {
                window.L.control = window.L.control || {};
                window.L.control.locate = window.L.Control.Locate.locate;
              }
            })();
          
L.OSM.locate = function (options) {
  const control = L.control.locate({
    icon: "icon geolocate",
    iconLoading: "icon geolocate",
    strings: {
      title: OSM.i18n.t("javascripts.map.locate.title"),
      popup: function (options) {
        return OSM.i18n.t("javascripts.map.locate." + options.unit + "Popup", { count: options.distance });
      }
    },
    ...options
  });

  control.onAdd = function (map) {
    const container = Object.getPrototypeOf(this).onAdd.apply(this, [map]);
    $(container)
      .removeClass("leaflet-control-locate leaflet-bar")
      .addClass("control-locate")
      .children("a")
      .attr("href", "#")
      .removeClass("leaflet-bar-part leaflet-bar-part-single")
      .addClass("control-button");
    return container;
  };

  return control;
};
L.OSM.layers = function (options) {
  const control = L.OSM.sidebarPane(options, "layers", "javascripts.map.layers.title", "javascripts.map.layers.header");

  control.onAddPane = function (map, button, $ui, toggle) {
    const layers = options.layers;

    const baseSection = $("<div>")
      .attr("class", "base-layers d-grid gap-3 p-3 border-bottom border-secondary-subtle")
      .appendTo($ui);

    layers.forEach(function (layer, i) {
      const id = "map-ui-layer-" + i;

      const buttonContainer = $("<div class='position-relative'>")
        .appendTo(baseSection);

      const mapContainer = $("<div class='position-absolute top-0 start-0 bottom-0 end-0 z-0 bg-body-secondary'>")
        .appendTo(buttonContainer);

      const input = $("<input type='radio' class='btn-check' name='layer'>")
        .prop("id", id)
        .prop("checked", map.hasLayer(layer))
        .appendTo(buttonContainer);

      const item = $("<label class='btn btn-outline-primary border-4 rounded-3 bg-transparent position-absolute p-0 h-100 w-100 overflow-hidden'>")
        .prop("for", id)
        .append($("<span class='badge position-absolute top-0 start-0 rounded-top-0 rounded-start-0 py-1 px-2 bg-body bg-opacity-75 text-body text-wrap text-start fs-6 lh-base'>").append(layer.options.name))
        .appendTo(buttonContainer);

      map.whenReady(function () {
        const miniMap = L.map(mapContainer[0], { attributionControl: false, zoomControl: false, keyboard: false })
          .addLayer(new layer.constructor(layer.options));

        miniMap.dragging.disable();
        miniMap.touchZoom.disable();
        miniMap.doubleClickZoom.disable();
        miniMap.scrollWheelZoom.disable();

        $ui
          .on("show", shown)
          .on("hide", hide);

        function shown() {
          miniMap.invalidateSize();
          setView({ animate: false });
          map.on("moveend", moved);
        }

        function hide() {
          map.off("moveend", moved);
        }

        function moved() {
          setView();
        }

        function setView(options) {
          miniMap.setView(map.getCenter(), Math.max(map.getZoom() - 2, 0), options);
        }
      });

      input.on("click", function () {
        for (const other of layers) {
          if (other !== layer) {
            map.removeLayer(other);
          }
        }
        map.addLayer(layer);
      });

      item.on("dblclick", toggle);

      map.on("baselayerchange", function () {
        input.prop("checked", map.hasLayer(layer));
      });
    });

    if (OSM.STATUS !== "api_offline" && OSM.STATUS !== "database_offline") {
      const overlaySection = $("<div>")
        .attr("class", "overlay-layers p-3")
        .appendTo($ui);

      $("<p>")
        .text(OSM.i18n.t("javascripts.map.layers.overlays"))
        .attr("class", "text-body-secondary small mb-2")
        .appendTo(overlaySection);

      const overlays = $("<ul class='list-unstyled form-check'>")
        .appendTo(overlaySection);

      const addOverlay = function (layer, name, maxArea) {
        const item = $("<li>")
          .appendTo(overlays);

        if (name === "notes" || name === "data") {
          item
            .attr("title", OSM.i18n.t("javascripts.site.map_" + name + "_zoom_in_tooltip"))
            .tooltip("disable");
        }

        const label = $("<label>")
          .attr("class", "form-check-label")
          .attr("id", `label-layers-${name}`)
          .appendTo(item);

        let checked = map.hasLayer(layer);

        const input = $("<input>")
          .attr("type", "checkbox")
          .attr("class", "form-check-input")
          .prop("checked", checked)
          .appendTo(label);

        label.append(OSM.i18n.t("javascripts.map.layers." + name));

        input.on("change", function () {
          checked = input.is(":checked");
          if (layer.cancelLoading) {
            layer.cancelLoading();
          }

          if (checked) {
            map.addLayer(layer);
          } else {
            map.removeLayer(layer);
            $(`#layers-${name}-loading`).remove();
          }
        });

        map.on("overlayadd overlayremove", function () {
          input.prop("checked", map.hasLayer(layer));
        });

        map.on("zoomend", function () {
          const disabled = map.getBounds().getSize() >= maxArea;
          $(input).prop("disabled", disabled);

          if (disabled && $(input).is(":checked")) {
            $(input).prop("checked", false)
              .trigger("change");
            checked = true;
          } else if (!disabled && !$(input).is(":checked") && checked) {
            $(input).prop("checked", true)
              .trigger("change");
          }

          $(item)
            .attr("class", disabled ? "disabled" : "")
            .tooltip(disabled ? "enable" : "disable");
        });
      };

      addOverlay(map.noteLayer, "notes", OSM.MAX_NOTE_REQUEST_AREA);
      addOverlay(map.dataLayer, "data", OSM.MAX_REQUEST_AREA);
      addOverlay(map.gpsLayer, "gps", Number.POSITIVE_INFINITY);
    }
  };

  return control;
};
L.OSM.key = function (options) {
  const control = L.OSM.sidebarPane(options, "key", null, "javascripts.key.title");

  control.onAddPane = function (map, button, $ui) {
    const $section = $("<div>")
      .attr("class", "p-3")
      .appendTo($ui);

    $ui
      .on("show", shown)
      .on("hide", hidden);

    map.on("baselayerchange", updateButton);

    updateButton();

    function shown() {
      map.on("zoomend baselayerchange", update);
      fetch("/key")
        .then(r => r.text())
        .then(html => { $section.html(html); })
        .then(update);
    }

    function hidden() {
      map.off("zoomend baselayerchange", update);
    }

    function updateButton() {
      const disabled = OSM.LAYERS_WITH_MAP_KEY.indexOf(map.getMapBaseLayerId()) === -1;
      button
        .toggleClass("disabled", disabled)
        .attr("data-bs-original-title",
              OSM.i18n.t(disabled ?
                "javascripts.key.tooltip_disabled" :
                "javascripts.key.tooltip"));
    }

    function update() {
      const layerId = map.getMapBaseLayerId(),
            zoom = map.getZoom();

      $(".mapkey-table-entry").each(function () {
        const data = $(this).data();
        $(this).toggle(
          layerId === data.layer &&
          (!data.zoomMin || zoom >= data.zoomMin) &&
          (!data.zoomMax || zoom <= data.zoomMax)
        );
      });
    }
  };

  return control;
};
L.OSM.note = function (options) {
  const control = L.control(options);

  control.onAdd = function (map) {
    const $container = $("<div>")
      .attr("class", "control-note");

    const link = $("<a>")
      .attr("class", "control-button")
      .attr("href", "#")
      .html("<span class=\"icon note\"></span>")
      .appendTo($container);

    map.on("zoomend", update);

    function update() {
      const wasDisabled = link.hasClass("disabled"),
            isDisabled = OSM.STATUS === "database_offline" || map.getZoom() < 12;
      link
        .toggleClass("disabled", isDisabled)
        .attr("data-bs-original-title", OSM.i18n.t(isDisabled ?
          "javascripts.site.createnote_disabled_tooltip" :
          "javascripts.site.createnote_tooltip"));
      if (isDisabled === wasDisabled) return;
      link.trigger(isDisabled ? "disabled" : "enabled");
    }

    update();

    return $container[0];
  };

  return control;
};
L.OSM.share = function (options) {
  const control = L.OSM.sidebarPane(options, "share", "javascripts.share.title", "javascripts.share.title"),
        marker = L.marker([0, 0], { draggable: true }),
        locationFilter = new L.LocationFilter({
          enableButton: false,
          adjustButton: false
        });

  control.onAddPane = function (map, button, $ui) {
    // Link / Embed
    $("#content").addClass("overlay-right-sidebar");

    const $linkSection = $("<div>")
      .attr("class", "share-link p-3 border-bottom border-secondary-subtle")
      .appendTo($ui);

    $("<h4>")
      .text(OSM.i18n.t("javascripts.share.link"))
      .appendTo($linkSection);

    let $form = $("<form>")
      .appendTo($linkSection);

    $("<div>")
      .attr("class", "form-check mb-3")
      .appendTo($form)
      .append($("<label>")
        .attr("for", "link_marker")
        .attr("class", "form-check-label")
        .text(OSM.i18n.t("javascripts.share.include_marker")))
      .append($("<input>")
        .attr("id", "link_marker")
        .attr("type", "checkbox")
        .attr("class", "form-check-input")
        .bind("change", toggleMarker));

    $("<div class='btn-group btn-group-sm mb-2'>")
      .appendTo($form)
      .append($("<a class='btn btn-primary'>")
        .addClass("active")
        .attr("for", "long_input")
        .attr("id", "long_link")
        .text(OSM.i18n.t("javascripts.share.long_link")))
      .append($("<a class='btn btn-primary'>")
        .attr("for", "short_input")
        .attr("id", "short_link")
        .text(OSM.i18n.t("javascripts.share.short_link")))
      .append($("<a class='btn btn-primary'>")
        .attr("for", "embed_html")
        .attr("id", "embed_link")
        .attr("data-bs-title", OSM.i18n.t("javascripts.site.embed_html_disabled"))
        .attr("href", "#")
        .text(OSM.i18n.t("javascripts.share.embed")))
      .on("click", "a", function (e) {
        e.preventDefault();
        if (!$(this).hasClass("btn-primary")) return;
        const id = "#" + $(this).attr("for");
        $(this).siblings("a")
          .removeClass("active");
        $(this).addClass("active");
        $linkSection.find(".share-tab")
          .hide();
        $linkSection.find(".share-tab:has(" + id + ")")
          .show()
          .find("input, textarea")
          .select();
      });

    $("<div>")
      .attr("class", "share-tab")
      .appendTo($form)
      .append($("<input>")
        .attr("id", "long_input")
        .attr("type", "text")
        .attr("class", "form-control form-control-sm font-monospace")
        .attr("readonly", true)
        .on("click", select));

    $("<div>")
      .attr("class", "share-tab")
      .hide()
      .appendTo($form)
      .append($("<input>")
        .attr("id", "short_input")
        .attr("type", "text")
        .attr("class", "form-control form-control-sm font-monospace")
        .attr("readonly", true)
        .on("click", select));

    $("<div>")
      .attr("class", "share-tab")
      .hide()
      .appendTo($form)
      .append(
        $("<textarea>")
          .attr("id", "embed_html")
          .attr("class", "form-control form-control-sm font-monospace")
          .attr("readonly", true)
          .on("click", select))
      .append(
        $("<p>")
          .attr("class", "text-body-secondary")
          .text(OSM.i18n.t("javascripts.share.paste_html")));

    // Geo URI

    const $geoUriSection = $("<div>")
      .attr("class", "share-geo-uri p-3 border-bottom border-secondary-subtle")
      .appendTo($ui);

    $("<h4>")
      .text(OSM.i18n.t("javascripts.share.geo_uri"))
      .appendTo($geoUriSection);

    $("<div>")
      .appendTo($geoUriSection)
      .append($("<a>")
        .attr("id", "geo_uri"));

    // Image

    const $imageSection = $("<div>")
      .attr("class", "share-image p-3")
      .appendTo($ui);

    $("<h4>")
      .text(OSM.i18n.t("javascripts.share.image"))
      .appendTo($imageSection);

    $("<div>")
      .attr("id", "export-warning")
      .attr("class", "text-body-secondary")
      .text(OSM.i18n.t("javascripts.share.only_layers_exported_as_image"))
      .append(
        $("<ul>").append(
          map.baseLayers
            .filter(layer => layer.options.canDownloadImage)
            .map(layer => $("<li>").text(layer.options.name))))
      .appendTo($imageSection);

    $form = $("<form>")
      .attr("id", "export-image")
      .attr("action", "/export/finish")
      .attr("method", "post")
      .appendTo($imageSection);

    $("<div>")
      .appendTo($form)
      .attr("class", "row mb-3")
      .append($("<label>")
        .attr("for", "mapnik_format")
        .attr("class", "col-auto col-form-label")
        .text(OSM.i18n.t("javascripts.share.format")))
      .append($("<div>")
        .attr("class", "col-auto")
        .append($("<select>")
          .attr("name", "mapnik_format")
          .attr("id", "mapnik_format")
          .attr("class", "form-select w-auto")
          .append($("<option>").val("png").text("PNG").prop("selected", true))
          .append($("<option>").val("jpeg").text("JPEG"))
          .append($("<option>").val("webp").text("WEBP"))
          .append($("<option>").val("svg").text("SVG"))
          .append($("<option>").val("pdf").text("PDF"))));

    $("<div>")
      .appendTo($form)
      .attr("class", "row mb-3")
      .attr("id", "mapnik_scale_row")
      .append($("<label>")
        .attr("for", "mapnik_scale")
        .attr("class", "col-auto col-form-label")
        .text(OSM.i18n.t("javascripts.share.scale")))
      .append($("<div>")
        .attr("class", "col-auto")
        .append($("<div>")
          .attr("class", "input-group flex-nowrap")
          .append($("<span>")
            .attr("class", "input-group-text")
            .text("1 : "))
          .append($("<input>")
            .attr("name", "mapnik_scale")
            .attr("id", "mapnik_scale")
            .attr("type", "text")
            .attr("class", "form-control")
            .on("change", update))));

    $("<div>")
      .attr("class", "row mb-3")
      .appendTo($form)
      .append($("<div>")
        .attr("class", "col-auto")
        .append($("<div>")
          .attr("class", "form-check")
          .append($("<label>")
            .attr("for", "image_filter")
            .attr("class", "form-check-label")
            .text(OSM.i18n.t("javascripts.share.custom_dimensions")))
          .append($("<input>")
            .attr("id", "image_filter")
            .attr("type", "checkbox")
            .attr("class", "form-check-input")
            .bind("change", toggleFilter))));

    const mapnikNames = ["minlon", "minlat", "maxlon", "maxlat", "lat", "lon"];

    for (const name of mapnikNames) {
      $("<input>")
        .attr("id", "mapnik_" + name)
        .attr("name", name)
        .attr("type", "hidden")
        .appendTo($form);
    }

    const hiddenExportDefaults = {
      format: "mapnik",
      zoom: map.getZoom(),
      width: 0,
      height: 0
    };

    for (const name in hiddenExportDefaults) {
      $("<input>")
        .attr("id", "map_" + name)
        .attr("name", name)
        .attr("value", hiddenExportDefaults[name])
        .attr("type", "hidden")
        .appendTo($form);
    }

    const csrfAttrs = { type: "hidden" };
    [[csrfAttrs.name, csrfAttrs.value]] = Object.entries(OSM.csrf);

    $("<input>")
      .attr(csrfAttrs)
      .appendTo($form);

    const args = {
      layer: "<span id=\"mapnik_image_layer\"></span>",
      width: "<span id=\"mapnik_image_width\"></span>",
      height: "<span id=\"mapnik_image_height\"></span>"
    };

    $("<p>")
      .attr("class", "text-body-secondary")
      .html(OSM.i18n.t("javascripts.share.image_dimensions", args))
      .appendTo($form);

    $("<input>")
      .attr("type", "submit")
      .attr("class", "btn btn-primary")
      .attr("value", OSM.i18n.t("javascripts.share.download"))
      .appendTo($form);

    locationFilter
      .on("change", update)
      .addTo(map);

    marker.on("dragend", movedMarker);
    map.on("move", movedMap);
    map.on("moveend baselayerchange overlayadd overlayremove", update);

    $ui
      .on("show", shown)
      .on("hide", hidden);

    function shown() {
      $("#mapnik_scale").val(getScale());
      update();
    }

    function hidden() {
      map.removeLayer(marker);
      map.options.scrollWheelZoom = map.options.doubleClickZoom = true;
      locationFilter.disable();
      update();
    }

    function toggleMarker() {
      if ($(this).is(":checked")) {
        marker.setLatLng(map.getCenter());
        map.addLayer(marker);
        map.options.scrollWheelZoom = map.options.doubleClickZoom = "center";
      } else {
        map.removeLayer(marker);
        map.options.scrollWheelZoom = map.options.doubleClickZoom = true;
      }
      update();
    }

    function toggleFilter() {
      if ($(this).is(":checked")) {
        locationFilter.setBounds(map.getBounds().pad(-0.2));
        locationFilter.enable();
      } else {
        locationFilter.disable();
      }
      update();
    }

    function movedMap() {
      marker.setLatLng(map.getCenter());
      update();
    }

    function movedMarker() {
      if (map.hasLayer(marker)) {
        map.off("move", movedMap);
        map.on("moveend", updateOnce);
        map.panTo(marker.getLatLng());
      }
    }

    function updateOnce() {
      map.off("moveend", updateOnce);
      map.on("move", movedMap);
      update();
    }

    function escapeHTML(string) {
      const htmlEscapes = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#x27;"
      };
      return string === null ? "" : String(string).replace(/[&<>"']/g, function (match) {
        return htmlEscapes[match];
      });
    }

    function update() {
      const layer = map.getMapBaseLayer();
      const canEmbed = Boolean(layer && layer.options.canEmbed);
      let bounds = map.getBounds();

      $("#link_marker")
        .prop("checked", map.hasLayer(marker));

      $("#image_filter")
        .prop("checked", locationFilter.isEnabled());

      // Link / Embed

      $("#short_input").val(map.getShortUrl(marker));
      $("#long_input").val(map.getUrl(marker));
      $("#short_link").attr("href", map.getShortUrl(marker));
      $("#long_link").attr("href", map.getUrl(marker));

      const params = new URLSearchParams({
        bbox: bounds.toBBoxString(),
        layer: map.getMapBaseLayerId()
      });

      if (map.hasLayer(marker)) {
        const latLng = marker.getLatLng().wrap();
        params.set("marker", latLng.lat + "," + latLng.lng);
      }

      $("#embed_link")
        .toggleClass("btn-primary", canEmbed)
        .toggleClass("btn-secondary", !canEmbed)
        .tooltip(canEmbed ? "disable" : "enable");
      if (!canEmbed && $("#embed_link").hasClass("active")) {
        $("#long_link").click();
      }

      $("#embed_html").val(
        "<iframe width=\"425\" height=\"350\" src=\"" +
          escapeHTML(OSM.SERVER_PROTOCOL + "://" + OSM.SERVER_URL + "/export/embed.html?" + params) +
          "\" style=\"border: 1px solid black\"></iframe><br/>" +
          "<small><a href=\"" + escapeHTML(map.getUrl(marker)) + "\">" +
          escapeHTML(OSM.i18n.t("javascripts.share.view_larger_map")) + "</a></small>");

      // Geo URI

      $("#geo_uri")
        .attr("href", map.getGeoUri(marker))
        .html(map.getGeoUri(marker));

      // Image

      if (locationFilter.isEnabled()) {
        bounds = locationFilter.getBounds();
      }

      let scale = $("#mapnik_scale").val();
      const size = L.bounds(L.CRS.EPSG3857.project(bounds.getSouthWest()),
                            L.CRS.EPSG3857.project(bounds.getNorthEast())).getSize(),
            maxScale = Math.floor(Math.sqrt(size.x * size.y / 0.3136));

      $("#mapnik_minlon").val(bounds.getWest());
      $("#mapnik_minlat").val(bounds.getSouth());
      $("#mapnik_maxlon").val(bounds.getEast());
      $("#mapnik_maxlat").val(bounds.getNorth());

      if (scale < maxScale) {
        scale = roundScale(maxScale);
        $("#mapnik_scale").val(scale);
      }

      const mapWidth = Math.round(size.x / scale / 0.00028);
      const mapHeight = Math.round(size.y / scale / 0.00028);
      $("#mapnik_image_width").text(mapWidth);
      $("#mapnik_image_height").text(mapHeight);

      const canDownloadImage = Boolean(layer && layer.options.canDownloadImage);

      $("#mapnik_image_layer").text(canDownloadImage ? layer.options.name : "");
      $("#map_format").val(canDownloadImage ? layer.options.layerId : "");

      $("#map_zoom").val(map.getZoom());
      $("#mapnik_lon").val(map.getCenter().lng);
      $("#mapnik_lat").val(map.getCenter().lat);
      $("#map_width").val(mapWidth);
      $("#map_height").val(mapHeight);

      $("#export-image").toggle(canDownloadImage);
      $("#export-warning").toggle(!canDownloadImage);
      $("#mapnik_scale_row").toggle(canDownloadImage && layer.options.layerId === "mapnik");
    }

    function select() {
      $(this).select();
    }

    function getScale() {
      const bounds = map.getBounds(),
            centerLat = bounds.getCenter().lat,
            halfWorldMeters = 6378137 * Math.PI * Math.cos(centerLat * Math.PI / 180),
            meters = halfWorldMeters * (bounds.getEast() - bounds.getWest()) / 180,
            pixelsPerMeter = map.getSize().x / meters,
            metersPerPixel = 1 / (92 * 39.3701);
      return Math.round(1 / (pixelsPerMeter * metersPerPixel));
    }

    function roundScale(scale) {
      const precision = 5 * Math.pow(10, Math.floor(Math.LOG10E * Math.log(scale)) - 2);
      return precision * Math.ceil(scale / precision);
    }
  };

  return control;
};
/*
 * Utility functions to decode/encode numbers and array's of numbers
 * to/from strings (Google maps polyline encoding)
 *
 * Extends the L.Polyline and L.Polygon object with methods to convert
 * to and create from these strings.
 *
 * Jan Pieter Waagmeester <jieter@jieter.nl>
 *
 * Original code from:
 * http://facstaff.unca.edu/mcmcclur/GoogleMaps/EncodePolyline/
 * (which is down as of december 2014)
 */

(function () {
    'use strict';

    var defaultOptions = function (options) {
        if (typeof options === 'number') {
            // Legacy
            options = {
                precision: options
            };
        } else {
            options = options || {};
        }

        options.precision = options.precision || 5;
        options.factor = options.factor || Math.pow(10, options.precision);
        options.dimension = options.dimension || 2;
        return options;
    };

    var PolylineUtil = {
        encode: function (points, options) {
            options = defaultOptions(options);

            var flatPoints = [];
            for (var i = 0, len = points.length; i < len; ++i) {
                var point = points[i];

                if (options.dimension === 2) {
                    flatPoints.push(point.lat || point[0]);
                    flatPoints.push(point.lng || point[1]);
                } else {
                    for (var dim = 0; dim < options.dimension; ++dim) {
                        flatPoints.push(point[dim]);
                    }
                }
            }

            return this.encodeDeltas(flatPoints, options);
        },

        decode: function (encoded, options) {
            options = defaultOptions(options);

            var flatPoints = this.decodeDeltas(encoded, options);

            var points = [];
            for (var i = 0, len = flatPoints.length; i + (options.dimension - 1) < len;) {
                var point = [];

                for (var dim = 0; dim < options.dimension; ++dim) {
                    point.push(flatPoints[i++]);
                }

                points.push(point);
            }

            return points;
        },

        encodeDeltas: function (numbers, options) {
            options = defaultOptions(options);

            var lastNumbers = [];

            for (var i = 0, len = numbers.length; i < len;) {
                for (var d = 0; d < options.dimension; ++d, ++i) {
                    var num = numbers[i].toFixed(options.precision);
                    var delta = num - (lastNumbers[d] || 0);
                    lastNumbers[d] = num;

                    numbers[i] = delta;
                }
            }

            return this.encodeFloats(numbers, options);
        },

        decodeDeltas: function (encoded, options) {
            options = defaultOptions(options);

            var lastNumbers = [];

            var numbers = this.decodeFloats(encoded, options);
            for (var i = 0, len = numbers.length; i < len;) {
                for (var d = 0; d < options.dimension; ++d, ++i) {
                    numbers[i] = Math.round((lastNumbers[d] = numbers[i] + (lastNumbers[d] || 0)) * options.factor) / options.factor;
                }
            }

            return numbers;
        },

        encodeFloats: function (numbers, options) {
            options = defaultOptions(options);

            for (var i = 0, len = numbers.length; i < len; ++i) {
                numbers[i] = Math.round(numbers[i] * options.factor);
            }

            return this.encodeSignedIntegers(numbers);
        },

        decodeFloats: function (encoded, options) {
            options = defaultOptions(options);

            var numbers = this.decodeSignedIntegers(encoded);
            for (var i = 0, len = numbers.length; i < len; ++i) {
                numbers[i] /= options.factor;
            }

            return numbers;
        },

        encodeSignedIntegers: function (numbers) {
            for (var i = 0, len = numbers.length; i < len; ++i) {
                var num = numbers[i];
                numbers[i] = (num < 0) ? ~(num << 1) : (num << 1);
            }

            return this.encodeUnsignedIntegers(numbers);
        },

        decodeSignedIntegers: function (encoded) {
            var numbers = this.decodeUnsignedIntegers(encoded);

            for (var i = 0, len = numbers.length; i < len; ++i) {
                var num = numbers[i];
                numbers[i] = (num & 1) ? ~(num >> 1) : (num >> 1);
            }

            return numbers;
        },

        encodeUnsignedIntegers: function (numbers) {
            var encoded = '';
            for (var i = 0, len = numbers.length; i < len; ++i) {
                encoded += this.encodeUnsignedInteger(numbers[i]);
            }
            return encoded;
        },

        decodeUnsignedIntegers: function (encoded) {
            var numbers = [];

            var current = 0;
            var shift = 0;

            for (var i = 0, len = encoded.length; i < len; ++i) {
                var b = encoded.charCodeAt(i) - 63;

                current |= (b & 0x1f) << shift;

                if (b < 0x20) {
                    numbers.push(current);
                    current = 0;
                    shift = 0;
                } else {
                    shift += 5;
                }
            }

            return numbers;
        },

        encodeSignedInteger: function (num) {
            num = (num < 0) ? ~(num << 1) : (num << 1);
            return this.encodeUnsignedInteger(num);
        },

        // This function is very similar to Google's, but I added
        // some stuff to deal with the double slash issue.
        encodeUnsignedInteger: function (num) {
            var value, encoded = '';
            while (num >= 0x20) {
                value = (0x20 | (num & 0x1f)) + 63;
                encoded += (String.fromCharCode(value));
                num >>= 5;
            }
            value = num + 63;
            encoded += (String.fromCharCode(value));

            return encoded;
        }
    };

    // Export Node module
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = PolylineUtil;
    }

    // Inject functionality into Leaflet
    if (typeof L === 'object') {
        if (!(L.Polyline.prototype.fromEncoded)) {
            L.Polyline.fromEncoded = function (encoded, options) {
                return L.polyline(PolylineUtil.decode(encoded), options);
            };
        }
        if (!(L.Polygon.prototype.fromEncoded)) {
            L.Polygon.fromEncoded = function (encoded, options) {
                return L.polygon(PolylineUtil.decode(encoded), options);
            };
        }

        var encodeMixin = {
            encodePath: function () {
                return PolylineUtil.encode(this.getLatLngs());
            }
        };

        if (!L.Polyline.prototype.encodePath) {
            L.Polyline.include(encodeMixin);
        }
        if (!L.Polygon.prototype.encodePath) {
            L.Polygon.include(encodeMixin);
        }

        L.PolylineUtil = PolylineUtil;
    }
})();
L.OSM.query = function (options) {
  const control = L.control(options);

  control.onAdd = function (map) {
    const $container = $("<div>")
      .attr("class", "control-query");

    const link = $("<a>")
      .attr("class", "control-button")
      .attr("href", "#")
      .html("<span class=\"icon query\"></span>")
      .appendTo($container);

    map.on("zoomend", update);

    function update() {
      const wasDisabled = link.hasClass("disabled"),
            isDisabled = map.getZoom() < 14;
      link
        .toggleClass("disabled", isDisabled)
        .attr("data-bs-original-title", OSM.i18n.t(isDisabled ?
          "javascripts.site.queryfeature_disabled_tooltip" :
          "javascripts.site.queryfeature_tooltip"));
      if (isDisabled === wasDisabled) return;
      link.trigger(isDisabled ? "disabled" : "enabled");
    }

    update();

    return $container[0];
  };

  return control;
};
/*
	Leaflet.contextmenu, a context menu for Leaflet.
	(c) 2015, Adam Ratcliffe, GeoSmart Maps Limited

	@preserve
*/

(function(factory) {
	// Packaging/modules magic dance
	var L;
	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['leaflet'], factory);
	} else if (typeof module === 'object' && typeof module.exports === 'object') {
		// Node/CommonJS
		L = require('leaflet');
		module.exports = factory(L);
	} else {
		// Browser globals
		if (typeof window.L === 'undefined') {
			throw new Error('Leaflet must be loaded first');
		}
		factory(window.L);
	}
})(function(L) {
L.Map.mergeOptions({
    contextmenuItems: []
});

L.Map.ContextMenu = L.Handler.extend({
    _touchstart: L.Browser.msPointer ? 'MSPointerDown' : L.Browser.pointer ? 'pointerdown' : 'touchstart',

    statics: {
        BASE_CLS: 'leaflet-contextmenu'
    },

    initialize: function (map) {
        L.Handler.prototype.initialize.call(this, map);

        this._items = [];
        this._visible = false;

        var container = this._container = L.DomUtil.create('div', L.Map.ContextMenu.BASE_CLS, map._container);
        container.style.zIndex = 10000;
        container.style.position = 'absolute';

        if (map.options.contextmenuWidth) {
            container.style.width = map.options.contextmenuWidth + 'px';
        }

        this._createItems();

        L.DomEvent
            .on(container, 'click', L.DomEvent.stop)
            .on(container, 'mousedown', L.DomEvent.stop)
            .on(container, 'dblclick', L.DomEvent.stop)
            .on(container, 'contextmenu', L.DomEvent.stop);
    },

    addHooks: function () {
        var container = this._map.getContainer();

        L.DomEvent
            .on(container, 'mouseleave', this._hide, this)
            .on(document, 'keydown', this._onKeyDown, this);

        if (L.Browser.touch) {
            L.DomEvent.on(document, this._touchstart, this._hide, this);
        }

        this._map.on({
            contextmenu: this._show,
            mousedown: this._hide,
            zoomstart: this._hide
        }, this);
    },

    removeHooks: function () {
        var container = this._map.getContainer();

        L.DomEvent
            .off(container, 'mouseleave', this._hide, this)
            .off(document, 'keydown', this._onKeyDown, this);

        if (L.Browser.touch) {
            L.DomEvent.off(document, this._touchstart, this._hide, this);
        }

        this._map.off({
            contextmenu: this._show,
            mousedown: this._hide,
            zoomstart: this._hide
        }, this);
    },

    showAt: function (point, data) {
        if (point instanceof L.LatLng) {
            point = this._map.latLngToContainerPoint(point);
        }
        this._showAtPoint(point, data);
    },

    hide: function () {
        this._hide();
    },

    addItem: function (options) {
        return this.insertItem(options);
    },

    insertItem: function (options, index) {
        index = index !== undefined ? index: this._items.length;

        var item = this._createItem(this._container, options, index);

        this._items.push(item);

        this._sizeChanged = true;

        this._map.fire('contextmenu.additem', {
            contextmenu: this,
            el: item.el,
            index: index
        });

        return item.el;
    },

    removeItem: function (item) {
        var container = this._container;

        if (!isNaN(item)) {
            item = container.children[item];
        }

        if (item) {
            this._removeItem(L.Util.stamp(item));

            this._sizeChanged = true;

            this._map.fire('contextmenu.removeitem', {
                contextmenu: this,
                el: item
            });

            return item;
        }

        return null;
    },

    removeAllItems: function () {
        var items = this._container.children,
            item;

        while (items.length) {
            item = items[0];
            this._removeItem(L.Util.stamp(item));
        }
        return items;
    },

    hideAllItems: function () {
        var item, i, l;

        for (i = 0, l = this._items.length; i < l; i++) {
            item = this._items[i];
            item.el.style.display = 'none';
        }
    },

    showAllItems: function () {
        var item, i, l;

        for (i = 0, l = this._items.length; i < l; i++) {
            item = this._items[i];
            item.el.style.display = '';
        }
    },

    setDisabled: function (item, disabled) {
        var container = this._container,
        itemCls = L.Map.ContextMenu.BASE_CLS + '-item';

        if (!isNaN(item)) {
            item = container.children[item];
        }

        if (item && L.DomUtil.hasClass(item, itemCls)) {
            if (disabled) {
                L.DomUtil.addClass(item, itemCls + '-disabled');
                this._map.fire('contextmenu.disableitem', {
                    contextmenu: this,
                    el: item
                });
            } else {
                L.DomUtil.removeClass(item, itemCls + '-disabled');
                this._map.fire('contextmenu.enableitem', {
                    contextmenu: this,
                    el: item
                });
            }
        }
    },

    isVisible: function () {
        return this._visible;
    },

    _createItems: function () {
        var itemOptions = this._map.options.contextmenuItems,
            item,
            i, l;

        for (i = 0, l = itemOptions.length; i < l; i++) {
            this._items.push(this._createItem(this._container, itemOptions[i]));
        }
    },

    _createItem: function (container, options, index) {
        if (options.separator || options === '-') {
            return this._createSeparator(container, index);
        }

        var itemCls = L.Map.ContextMenu.BASE_CLS + '-item',
            cls = options.disabled ? (itemCls + ' ' + itemCls + '-disabled') : itemCls,
            el = this._insertElementAt('a', cls, container, index),
            callback = this._createEventHandler(el, options.callback, options.context, options.hideOnSelect),
            icon = this._getIcon(options),
            iconCls = this._getIconCls(options),
            html = '';

        if (icon) {
            html = '<img class="' + L.Map.ContextMenu.BASE_CLS + '-icon" src="' + icon + '"/>';
        } else if (iconCls) {
            html = '<span class="' + L.Map.ContextMenu.BASE_CLS + '-icon ' + iconCls + '"></span>';
        }

        el.innerHTML = html + options.text;
        el.href = '#';

        L.DomEvent
            .on(el, 'mouseover', this._onItemMouseOver, this)
            .on(el, 'mouseout', this._onItemMouseOut, this)
            .on(el, 'mousedown', L.DomEvent.stopPropagation)
            .on(el, 'click', callback);

        if (L.Browser.touch) {
            L.DomEvent.on(el, this._touchstart, L.DomEvent.stopPropagation);
        }

        // Devices without a mouse fire "mouseover" on tap, but never “mouseout"
        if (!L.Browser.pointer) {
            L.DomEvent.on(el, 'click', this._onItemMouseOut, this);
        }

        return {
            id: L.Util.stamp(el),
            el: el,
            callback: callback
        };
    },

    _removeItem: function (id) {
        var item,
            el,
            i, l, callback;

        for (i = 0, l = this._items.length; i < l; i++) {
            item = this._items[i];

            if (item.id === id) {
                el = item.el;
                callback = item.callback;

                if (callback) {
                    L.DomEvent
                        .off(el, 'mouseover', this._onItemMouseOver, this)
                        .off(el, 'mouseover', this._onItemMouseOut, this)
                        .off(el, 'mousedown', L.DomEvent.stopPropagation)
                        .off(el, 'click', callback);

                    if (L.Browser.touch) {
                        L.DomEvent.off(el, this._touchstart, L.DomEvent.stopPropagation);
                    }

                    if (!L.Browser.pointer) {
                        L.DomEvent.on(el, 'click', this._onItemMouseOut, this);
                    }
                }

                this._container.removeChild(el);
                this._items.splice(i, 1);

                return item;
            }
        }
        return null;
    },

    _createSeparator: function (container, index) {
        var el = this._insertElementAt('div', L.Map.ContextMenu.BASE_CLS + '-separator', container, index);

        return {
            id: L.Util.stamp(el),
            el: el
        };
    },

    _createEventHandler: function (el, func, context, hideOnSelect) {
        var me = this,
            map = this._map,
            disabledCls = L.Map.ContextMenu.BASE_CLS + '-item-disabled',
            hideOnSelect = (hideOnSelect !== undefined) ? hideOnSelect : true;

        return function (e) {
            if (L.DomUtil.hasClass(el, disabledCls)) {
                return;
            }

            var map = me._map,
                containerPoint = me._showLocation.containerPoint,
                layerPoint = map.containerPointToLayerPoint(containerPoint),
                latlng = map.layerPointToLatLng(layerPoint),
                relatedTarget = me._showLocation.relatedTarget,
                data = {
                  containerPoint: containerPoint,
                  layerPoint: layerPoint,
                  latlng: latlng,
                  relatedTarget: relatedTarget
                };

            if (hideOnSelect) {
                me._hide();
            }

            if (func) {
                func.call(context || map, data);
            }

            me._map.fire('contextmenu.select', {
                contextmenu: me,
                el: el
            });
        };
    },

    _insertElementAt: function (tagName, className, container, index) {
        var refEl,
            el = document.createElement(tagName);

        el.className = className;

        if (index !== undefined) {
            refEl = container.children[index];
        }

        if (refEl) {
            container.insertBefore(el, refEl);
        } else {
            container.appendChild(el);
        }

        return el;
    },

    _show: function (e) {
        this._showAtPoint(e.containerPoint, e);
    },

    _showAtPoint: function (pt, data) {
        if (this._items.length) {
            var map = this._map,
            event = L.extend(data || {}, {contextmenu: this});

            this._showLocation = {
                containerPoint: pt
            };

            if (data && data.relatedTarget){
                this._showLocation.relatedTarget = data.relatedTarget;
            }

            this._setPosition(pt);

            if (!this._visible) {
                this._container.style.display = 'block';
                this._visible = true;
            }

            this._map.fire('contextmenu.show', event);
        }
    },

    _hide: function () {
        if (this._visible) {
            this._visible = false;
            this._container.style.display = 'none';
            this._map.fire('contextmenu.hide', {contextmenu: this});
        }
    },

    _getIcon: function (options) {
        return L.Browser.retina && options.retinaIcon || options.icon;
    },

    _getIconCls: function (options) {
        return L.Browser.retina && options.retinaIconCls || options.iconCls;
    },

    _setPosition: function (pt) {
        var mapSize = this._map.getSize(),
            container = this._container,
            containerSize = this._getElementSize(container),
            anchor;

        if (this._map.options.contextmenuAnchor) {
            anchor = L.point(this._map.options.contextmenuAnchor);
            pt = pt.add(anchor);
        }

        container._leaflet_pos = pt;

        if (pt.x + containerSize.x > mapSize.x) {
            container.style.left = 'auto';
            container.style.right = Math.min(Math.max(mapSize.x - pt.x, 0), mapSize.x - containerSize.x - 1) + 'px';
        } else {
            container.style.left = Math.max(pt.x, 0) + 'px';
            container.style.right = 'auto';
        }

        if (pt.y + containerSize.y > mapSize.y) {
            container.style.top = 'auto';
            container.style.bottom = Math.min(Math.max(mapSize.y - pt.y, 0), mapSize.y - containerSize.y - 1) + 'px';
        } else {
            container.style.top = Math.max(pt.y, 0) + 'px';
            container.style.bottom = 'auto';
        }
    },

    _getElementSize: function (el) {
        var size = this._size,
            initialDisplay = el.style.display;

        if (!size || this._sizeChanged) {
            size = {};

            el.style.left = '-999999px';
            el.style.right = 'auto';
            el.style.display = 'block';

            size.x = el.offsetWidth;
            size.y = el.offsetHeight;

            el.style.left = 'auto';
            el.style.display = initialDisplay;

            this._sizeChanged = false;
        }

        return size;
    },

    _onKeyDown: function (e) {
        var key = e.keyCode;

        // If ESC pressed and context menu is visible hide it
        if (key === 27) {
            this._hide();
        }
    },

    _onItemMouseOver: function (e) {
        L.DomUtil.addClass(e.target || e.srcElement, 'over');
    },

    _onItemMouseOut: function (e) {
        L.DomUtil.removeClass(e.target || e.srcElement, 'over');
    }
});

L.Map.addInitHook('addHandler', 'contextmenu', L.Map.ContextMenu);
L.Mixin.ContextMenu = {
    bindContextMenu: function (options) {
        L.setOptions(this, options);
        this._initContextMenu();

        return this;
    },

    unbindContextMenu: function (){
        this.off('contextmenu', this._showContextMenu, this);

        return this;
    },

    addContextMenuItem: function (item) {
            this.options.contextmenuItems.push(item);
    },

    removeContextMenuItemWithIndex: function (index) {
        var items = [];
        for (var i = 0; i < this.options.contextmenuItems.length; i++) {
            if (this.options.contextmenuItems[i].index == index){
                items.push(i);
            }
        }
        var elem = items.pop();
        while (elem !== undefined) {
            this.options.contextmenuItems.splice(elem,1);
            elem = items.pop();
        }
    },

    replaceContextMenuItem: function (item) {
        this.removeContextMenuItemWithIndex(item.index);
        this.addContextMenuItem(item);
    },

    _initContextMenu: function () {
        this._items = [];

        this.on('contextmenu', this._showContextMenu, this);
    },

    _showContextMenu: function (e) {
        var itemOptions,
            data, pt, i, l;

        if (this._map.contextmenu) {
            data = L.extend({relatedTarget: this}, e);

            pt = this._map.mouseEventToContainerPoint(e.originalEvent);

            if (!this.options.contextmenuInheritItems) {
                this._map.contextmenu.hideAllItems();
            }

            for (i = 0, l = this.options.contextmenuItems.length; i < l; i++) {
                itemOptions = this.options.contextmenuItems[i];
                this._items.push(this._map.contextmenu.insertItem(itemOptions, itemOptions.index));
            }

            this._map.once('contextmenu.hide', this._hideContextMenu, this);

            this._map.contextmenu.showAt(pt, data);
        }
    },

    _hideContextMenu: function () {
        var i, l;

        for (i = 0, l = this._items.length; i < l; i++) {
            this._map.contextmenu.removeItem(this._items[i]);
        }
        this._items.length = 0;

        if (!this.options.contextmenuInheritItems) {
            this._map.contextmenu.showAllItems();
        }
    }
};

var classes = [L.Marker, L.Path],
    defaultOptions = {
        contextmenu: false,
        contextmenuItems: [],
        contextmenuInheritItems: true
    },
    cls, i, l;

for (i = 0, l = classes.length; i < l; i++) {
    cls = classes[i];

    // L.Class should probably provide an empty options hash, as it does not test
    // for it here and add if needed
    if (!cls.prototype.options) {
        cls.prototype.options = defaultOptions;
    } else {
        cls.mergeOptions(defaultOptions);
    }

    cls.addInitHook(function () {
        if (this.options.contextmenu) {
            this._initContextMenu();
        }
    });

    cls.include(L.Mixin.ContextMenu);
}
return L.Map.ContextMenu;
});
OSM.initializeContextMenu = function (map) {
  map.contextmenu.addItem({
    text: OSM.i18n.t("javascripts.context.directions_from"),
    callback: function directionsFromHere(e) {
      const latlng = OSM.cropLocation(e.latlng, map.getZoom());

      OSM.router.route("/directions?" + new URLSearchParams({
        from: latlng.join(","),
        to: getDirectionsEndpointCoordinatesFromInput($("#route_to"))
      }));
    }
  });

  map.contextmenu.addItem({
    text: OSM.i18n.t("javascripts.context.directions_to"),
    callback: function directionsToHere(e) {
      const latlng = OSM.cropLocation(e.latlng, map.getZoom());

      OSM.router.route("/directions?" + new URLSearchParams({
        from: getDirectionsEndpointCoordinatesFromInput($("#route_from")),
        to: latlng.join(",")
      }));
    }
  });

  map.contextmenu.addItem({
    text: OSM.i18n.t("javascripts.context.add_note"),
    callback: function addNoteHere(e) {
      const [lat, lon] = OSM.cropLocation(e.latlng, map.getZoom());

      OSM.router.route("/note/new?" + new URLSearchParams({ lat, lon }));
    }
  });

  map.contextmenu.addItem({
    text: OSM.i18n.t("javascripts.context.show_address"),
    callback: function describeLocation(e) {
      const [lat, lon] = OSM.cropLocation(e.latlng, map.getZoom());

      OSM.router.route("/search?" + new URLSearchParams({ lat, lon }));
    }
  });

  map.contextmenu.addItem({
    text: OSM.i18n.t("javascripts.context.query_features"),
    callback: function queryFeatures(e) {
      const [lat, lon] = OSM.cropLocation(e.latlng, map.getZoom());

      OSM.router.route("/query?" + new URLSearchParams({ lat, lon }));
    }
  });

  map.contextmenu.addItem({
    text: OSM.i18n.t("javascripts.context.centre_map"),
    callback: function centreMap(e) {
      map.panTo(e.latlng);
    }
  });

  map.on("mousedown", function (e) {
    if (e.originalEvent.shiftKey) map.contextmenu.disable();
    else map.contextmenu.enable();
  });

  function getDirectionsEndpointCoordinatesFromInput(input) {
    if (input.attr("data-lat") && input.attr("data-lon")) {
      return input.attr("data-lat") + "," + input.attr("data-lon");
    }
    return $(input).val();
  }

  const updateMenu = function updateMenu() {
    map.contextmenu.setDisabled(2, map.getZoom() < 12);
    map.contextmenu.setDisabled(4, map.getZoom() < 14);
  };

  map.on("zoomend", updateMenu);
  updateMenu();
};
OSM.Search = function (map) {
  $(".search_form input[name=query]").on("input", function (e) {
    if ($(e.target).val() === "") {
      $(".describe_location").fadeIn(100);
    } else {
      $(".describe_location").fadeOut(100);
    }
  });

  $(".search_form a.btn.switch_link").on("click", function (e) {
    e.preventDefault();
    const query = $(this).closest("form").find("input[name=query]").val();
    let search = "";
    if (query) search = "?" + new URLSearchParams({ to: query });
    OSM.router.route("/directions" + search + OSM.formatHash(map));
  });

  $(".search_form").on("submit", function (e) {
    e.preventDefault();
    $("header").addClass("closed");
    const query = $(this).find("input[name=query]").val();
    let search = "/";
    if (query) search = "/search?" + new URLSearchParams({ query });
    OSM.router.route(search + OSM.formatHash(map));
  });

  $(".describe_location").on("click", function (e) {
    e.preventDefault();
    $("header").addClass("closed");
    const [lat, lon] = OSM.cropLocation(map.getCenter(), map.getZoom());

    OSM.router.route("/search?" + new URLSearchParams({ lat, lon }));
  });

  $("#sidebar_content")
    .on("click", ".search_more a", clickSearchMore)
    .on("click", ".search_results_entry a.set_position", clickSearchResult)
    .on("mouseover", "li.search_results_entry:has(a.set_position)", showSearchResult)
    .on("mouseout", "li.search_results_entry:has(a.set_position)", hideSearchResult);

  const markers = L.layerGroup().addTo(map);

  function clickSearchMore(e) {
    e.preventDefault();
    e.stopPropagation();

    const div = $(this).parents(".search_more");

    $(this).hide();
    div.find(".loader").show();

    fetch($(this).attr("href"), {
      method: "POST",
      body: new URLSearchParams(OSM.csrf)
    })
      .then(response => response.text())
      .then(data => div.replaceWith(data));
  }

  function showSearchResult() {
    let marker = $(this).data("marker");

    if (!marker) {
      const data = $(this).find("a.set_position").data();

      marker = L.marker([data.lat, data.lon], { icon: OSM.getUserIcon() });

      $(this).data("marker", marker);
    }

    markers.addLayer(marker);
  }

  function hideSearchResult() {
    const marker = $(this).data("marker");

    if (marker) {
      markers.removeLayer(marker);
    }
  }

  function panToSearchResult(data) {
    if (data.minLon && data.minLat && data.maxLon && data.maxLat) {
      map.fitBounds([[data.minLat, data.minLon], [data.maxLat, data.maxLon]]);
    } else {
      map.setView([data.lat, data.lon], data.zoom);
    }
  }

  function clickSearchResult(e) {
    const data = $(this).data();

    panToSearchResult(data);

    // Let clicks to object browser links propagate.
    if (data.type && data.id) return;

    e.preventDefault();
    e.stopPropagation();
  }

  const page = {};

  page.pushstate = page.popstate = function (path) {
    const params = new URLSearchParams(path.substring(path.indexOf("?")));
    if (params.has("query")) {
      $(".search_form input[name=query]").val(params.get("query"));
      $(".describe_location").hide();
    } else if (params.has("lat") && params.has("lon")) {
      $(".search_form input[name=query]").val(params.get("lat") + ", " + params.get("lon"));
      $(".describe_location").hide();
    }
    OSM.loadSidebarContent(path, page.load);
  };

  page.load = function () {
    $(".search_results_entry").each(function (index) {
      const entry = $(this);
      fetch(entry.data("href"), {
        method: "POST",
        body: new URLSearchParams({
          zoom: map.getZoom(),
          minlon: map.getBounds().getWest(),
          minlat: map.getBounds().getSouth(),
          maxlon: map.getBounds().getEast(),
          maxlat: map.getBounds().getNorth(),
          ...OSM.csrf
        })
      })
        .then(response => response.text())
        .then(function (html) {
          entry.html(html);
          // go to first result of first geocoder
          if (index === 0) {
            const firstResult = entry.find("*[data-lat][data-lon]:first").first();
            if (firstResult.length) {
              panToSearchResult(firstResult.data());
            }
          }
        });
    });

    return map.getState();
  };

  page.unload = function () {
    markers.clearLayers();
    $(".search_form input[name=query]").val("");
    $(".describe_location").fadeIn(100);
  };

  return page;
};
OSM.initializeDataLayer = function (map) {
  let dataLoader, loadedBounds;
  const dataLayer = map.dataLayer;

  dataLayer.setStyle({
    way: {
      weight: 3,
      color: "#000000",
      opacity: 0.4
    },
    area: {
      weight: 3,
      color: "#ff0000"
    },
    node: {
      color: "#00ff00"
    }
  });

  dataLayer.isWayArea = function () {
    return false;
  };

  dataLayer.on("click", function (e) {
    onSelect(e.layer);
  });

  dataLayer.on("add", function () {
    map.fire("overlayadd", { layer: this });
    map.on("moveend", updateData);
    updateData();
  });

  dataLayer.on("remove", function () {
    if (dataLoader) dataLoader.abort();
    dataLoader = null;
    map.off("moveend", updateData);
    $("#browse_status").empty();
    map.fire("overlayremove", { layer: this });
  });

  function updateData() {
    const bounds = map.getBounds();
    if (!loadedBounds || !loadedBounds.contains(bounds)) {
      getData();
    }
  }

  function displayFeatureWarning(num_features, add, cancel) {
    $("#browse_status").html(
      $("<div class='p-3'>").append(
        $("<div class='d-flex'>").append(
          $("<h2 class='flex-grow-1 text-break'>")
            .text(OSM.i18n.t("browse.start_rjs.load_data")),
          $("<div>").append(
            $("<button type='button' class='btn-close'>")
              .attr("aria-label", OSM.i18n.t("javascripts.close"))
              .click(cancel))),
        $("<p class='alert alert-warning'>")
          .text(OSM.i18n.t("browse.start_rjs.feature_warning", { num_features })),
        $("<input type='submit' class='btn btn-primary d-block mx-auto'>")
          .val(OSM.i18n.t("browse.start_rjs.load_data"))
          .click(add)));
  }

  function displayLoadError(message, close) {
    $("#browse_status").html(
      $("<div class='p-3'>").append(
        $("<div class='d-flex'>").append(
          $("<h2 class='flex-grow-1 text-break'>")
            .text(OSM.i18n.t("browse.start_rjs.load_data")),
          $("<div>").append(
            $("<button type='button' class='btn-close'>")
              .attr("aria-label", OSM.i18n.t("javascripts.close"))
              .click(close))),
        $("<p class='alert alert-warning'>")
          .text(OSM.i18n.t("browse.start_rjs.feature_error", { message: message }))));
  }

  function getData() {
    const bounds = map.getBounds();
    const url = "/api/" + OSM.API_VERSION + "/map.json?bbox=" + bounds.toBBoxString();

    /*
     * Modern browsers are quite happy showing far more than 100 features in
     * the data browser, so increase the limit to 4000.
     */
    const maxFeatures = 4000;

    if (dataLoader) dataLoader.abort();

    $("#layers-data-loading").remove();

    const spanLoading = $("<span>")
      .attr("id", "layers-data-loading")
      .attr("class", "spinner-border spinner-border-sm ms-1")
      .attr("role", "status")
      .html("<span class='visually-hidden'>" + OSM.i18n.t("browse.start_rjs.loading") + "</span>")
      .appendTo($("#label-layers-data"));

    dataLoader = new AbortController();
    fetch(url, { signal: dataLoader.signal })
      .then(response => {
        if (response.ok) return response.json();
        const status = response.statusText || response.status;
        if (response.status !== 400) throw new Error(status);
        return response.text().then(text => {
          throw new Error(text || status);
        });
      })
      .then(function (data) {
        dataLayer.clearLayers();

        const features = dataLayer.buildFeatures(data);

        function addFeatures() {
          $("#browse_status").empty();
          dataLayer.addData(features);
          loadedBounds = bounds;
        }

        function cancelAddFeatures() {
          $("#browse_status").empty();
        }

        if (features.length < maxFeatures) {
          addFeatures();
        } else {
          displayFeatureWarning(features.length, addFeatures, cancelAddFeatures);
        }

        if (map._objectLayer) {
          map._objectLayer.bringToFront();
        }
      })
      .catch(function (error) {
        if (error.name === "AbortError") return;

        displayLoadError(error?.message, () => {
          $("#browse_status").empty();
        });
      })
      .finally(() => {
        dataLoader = null;
        spanLoading.remove();
      });
  }

  function onSelect(layer) {
    OSM.router.route("/" + layer.feature.type + "/" + layer.feature.id);
  }
};
OSM.Export = function (map) {
  const page = {};

  const locationFilter = new L.LocationFilter({
    enableButton: false,
    adjustButton: false
  }).on("change", update);

  function getBounds() {
    return L.latLngBounds(
      L.latLng($("#minlat").val(), $("#minlon").val()),
      L.latLng($("#maxlat").val(), $("#maxlon").val()));
  }

  function boundsChanged() {
    const bounds = getBounds();
    map.fitBounds(bounds);
    locationFilter.setBounds(bounds);
    locationFilter.enable();
    validateControls();
  }

  function enableFilter(e) {
    e.preventDefault();

    $("#drag_box").hide();

    locationFilter.setBounds(map.getBounds().pad(-0.2));
    locationFilter.enable();
    validateControls();
  }

  function update() {
    setBounds(locationFilter.isEnabled() ? locationFilter.getBounds() : map.getBounds());
    validateControls();
  }

  function setBounds(bounds) {
    const truncated = [bounds.getSouthWest(), bounds.getNorthEast()]
      .map(c => OSM.cropLocation(c, map.getZoom()));
    $("#minlon").val(truncated[0][1]);
    $("#minlat").val(truncated[0][0]);
    $("#maxlon").val(truncated[1][1]);
    $("#maxlat").val(truncated[1][0]);

    $("#export_overpass").attr("href",
                               "https://overpass-api.de/api/map?bbox=" +
                               truncated.map(p => p.reverse()).join());
  }

  function validateControls() {
    $("#export_osm_too_large").toggle(getBounds().getSize() > OSM.MAX_REQUEST_AREA);
    $("#export_commit").toggle(getBounds().getSize() < OSM.MAX_REQUEST_AREA);
  }

  function checkSubmit(e) {
    if (getBounds().getSize() > OSM.MAX_REQUEST_AREA) e.preventDefault();
  }

  page.pushstate = page.popstate = function (path) {
    OSM.loadSidebarContent(path, page.load);
  };

  page.load = function () {
    map
      .addLayer(locationFilter)
      .on("moveend", update);

    $("#maxlat, #minlon, #maxlon, #minlat").change(boundsChanged);
    $("#drag_box").click(enableFilter);
    $(".export_form").on("submit", checkSubmit);

    update();
    return map.getState();
  };

  page.unload = function () {
    map
      .removeLayer(locationFilter)
      .off("moveend", update);
  };

  return page;
};
OSM.initializeNotesLayer = function (map) {
  let noteLoader;
  const noteLayer = map.noteLayer;
  let notes = {};

  const noteIcons = {
    "new": L.icon({
      iconUrl: OSM.NEW_NOTE_MARKER,
      iconSize: [25, 40],
      iconAnchor: [12, 40]
    }),
    "open": L.icon({
      iconUrl: OSM.OPEN_NOTE_MARKER,
      iconSize: [25, 40],
      iconAnchor: [12, 40]
    }),
    "closed": L.icon({
      iconUrl: OSM.CLOSED_NOTE_MARKER,
      iconSize: [25, 40],
      iconAnchor: [12, 40]
    })
  };

  noteLayer.on("add", () => {
    loadNotes();
    map.on("moveend", loadNotes);
    map.fire("overlayadd", { layer: noteLayer });
  }).on("remove", () => {
    if (noteLoader) noteLoader.abort();
    noteLoader = null;
    map.off("moveend", loadNotes);
    noteLayer.clearLayers();
    notes = {};
    map.fire("overlayremove", { layer: noteLayer });
  }).on("click", function (e) {
    if (e.layer.id) {
      OSM.router.route("/note/" + e.layer.id);
    }
  });

  function updateMarker(old_marker, feature) {
    let marker = old_marker;
    if (marker) {
      marker.setIcon(noteIcons[feature.properties.status]);
    } else {
      let title;
      const description = feature.properties.comments[0];

      if (description?.action === "opened") {
        title = description.text;
      }

      marker = L.marker(feature.geometry.coordinates.reverse(), {
        icon: noteIcons[feature.properties.status],
        title,
        opacity: 0.8,
        interactive: true
      });
      marker.id = feature.properties.id;
      marker.addTo(noteLayer);
    }
    return marker;
  }

  noteLayer.getLayerId = function (marker) {
    return marker.id;
  };

  function loadNotes() {
    const bounds = map.getBounds();
    const size = bounds.getSize();

    if (size <= OSM.MAX_NOTE_REQUEST_AREA) {
      const url = "/api/" + OSM.API_VERSION + "/notes.json?bbox=" + bounds.toBBoxString();

      if (noteLoader) noteLoader.abort();

      noteLoader = new AbortController();
      fetch(url, { signal: noteLoader.signal })
        .then(response => response.json())
        .then(success)
        .catch(() => {})
        .finally(() => noteLoader = null);
    }

    function success(json) {
      const oldNotes = notes;
      notes = {};
      for (const feature of json.features) {
        const marker = oldNotes[feature.properties.id];
        delete oldNotes[feature.properties.id];
        notes[feature.properties.id] = updateMarker(marker, feature);
      }

      for (const id in oldNotes) {
        noteLayer.removeLayer(oldNotes[id]);
      }
    }
  }
};
 /*!
 * jQuery Simulate v@VERSION - simulate browser mouse and keyboard events
 * https://github.com/jquery/jquery-simulate
 *
 * Copyright jQuery Foundation and other contributors
 * Released under the MIT license.
 * http://jquery.org/license
 *
 * Date: @DATE
 */

;(function( $, undefined ) {

var rkeyEvent = /^key/,
	rmouseEvent = /^(?:mouse|contextmenu)|click/;

$.fn.simulate = function( type, options ) {
	return this.each(function() {
		new $.simulate( this, type, options );
	});
};

$.simulate = function( elem, type, options ) {
	var method = $.camelCase( "simulate-" + type );

	this.target = elem;
	this.options = options;

	if ( this[ method ] ) {
		this[ method ]();
	} else {
		this.simulateEvent( elem, type, options );
	}
};

$.extend( $.simulate, {

	keyCode: {
		BACKSPACE: 8,
		COMMA: 188,
		DELETE: 46,
		DOWN: 40,
		END: 35,
		ENTER: 13,
		ESCAPE: 27,
		HOME: 36,
		LEFT: 37,
		NUMPAD_ADD: 107,
		NUMPAD_DECIMAL: 110,
		NUMPAD_DIVIDE: 111,
		NUMPAD_ENTER: 108,
		NUMPAD_MULTIPLY: 106,
		NUMPAD_SUBTRACT: 109,
		PAGE_DOWN: 34,
		PAGE_UP: 33,
		PERIOD: 190,
		RIGHT: 39,
		SPACE: 32,
		TAB: 9,
		UP: 38
	},

	buttonCode: {
		LEFT: 0,
		MIDDLE: 1,
		RIGHT: 2
	}
});

$.extend( $.simulate.prototype, {

	simulateEvent: function( elem, type, options ) {
		var event = this.createEvent( type, options );
		this.dispatchEvent( elem, type, event, options );
	},

	createEvent: function( type, options ) {
		if ( rkeyEvent.test( type ) ) {
			return this.keyEvent( type, options );
		}

		if ( rmouseEvent.test( type ) ) {
			return this.mouseEvent( type, options );
		}
	},

	mouseEvent: function( type, options ) {
		var event, eventDoc, doc, body;
		options = $.extend({
			bubbles: true,
			cancelable: (type !== "mousemove"),
			view: window,
			detail: 0,
			screenX: 0,
			screenY: 0,
			clientX: 1,
			clientY: 1,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			metaKey: false,
			button: 0,
			relatedTarget: undefined
		}, options );

		if ( document.createEvent ) {
			event = document.createEvent( "MouseEvents" );
			event.initMouseEvent( type, options.bubbles, options.cancelable,
				options.view, options.detail,
				options.screenX, options.screenY, options.clientX, options.clientY,
				options.ctrlKey, options.altKey, options.shiftKey, options.metaKey,
				options.button, options.relatedTarget || document.body.parentNode );

			// IE 9+ creates events with pageX and pageY set to 0.
			// Trying to modify the properties throws an error,
			// so we define getters to return the correct values.
			if ( event.pageX === 0 && event.pageY === 0 && Object.defineProperty ) {
				eventDoc = event.relatedTarget.ownerDocument || document;
				doc = eventDoc.documentElement;
				body = eventDoc.body;

				Object.defineProperty( event, "pageX", {
					get: function() {
						return options.clientX +
							( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) -
							( doc && doc.clientLeft || body && body.clientLeft || 0 );
					}
				});
				Object.defineProperty( event, "pageY", {
					get: function() {
						return options.clientY +
							( doc && doc.scrollTop || body && body.scrollTop || 0 ) -
							( doc && doc.clientTop || body && body.clientTop || 0 );
					}
				});
			}
		} else if ( document.createEventObject ) {
			event = document.createEventObject();
			$.extend( event, options );
			// standards event.button uses constants defined here: http://msdn.microsoft.com/en-us/library/ie/ff974877(v=vs.85).aspx
			// old IE event.button uses constants defined here: http://msdn.microsoft.com/en-us/library/ie/ms533544(v=vs.85).aspx
			// so we actually need to map the standard back to oldIE
			event.button = {
				0: 1,
				1: 4,
				2: 2
			}[ event.button ] || ( event.button === -1 ? 0 : event.button );
		}

		return event;
	},

	keyEvent: function( type, options ) {
		var event;
		options = $.extend({
			bubbles: true,
			cancelable: true,
			view: window,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			metaKey: false,
			keyCode: 0,
			charCode: undefined
		}, options );

		if ( document.createEvent ) {
			try {
				event = document.createEvent( "KeyEvents" );
				event.initKeyEvent( type, options.bubbles, options.cancelable, options.view,
					options.ctrlKey, options.altKey, options.shiftKey, options.metaKey,
					options.keyCode, options.charCode );
			// initKeyEvent throws an exception in WebKit
			// see: http://stackoverflow.com/questions/6406784/initkeyevent-keypress-only-works-in-firefox-need-a-cross-browser-solution
			// and also https://bugs.webkit.org/show_bug.cgi?id=13368
			// fall back to a generic event until we decide to implement initKeyboardEvent
			} catch( err ) {
				event = document.createEvent( "Events" );
				event.initEvent( type, options.bubbles, options.cancelable );
				$.extend( event, {
					view: options.view,
					ctrlKey: options.ctrlKey,
					altKey: options.altKey,
					shiftKey: options.shiftKey,
					metaKey: options.metaKey,
					keyCode: options.keyCode,
					charCode: options.charCode
				});
			}
		} else if ( document.createEventObject ) {
			event = document.createEventObject();
			$.extend( event, options );
		}

		if ( !!/msie [\w.]+/.exec( navigator.userAgent.toLowerCase() ) || (({}).toString.call( window.opera ) === "[object Opera]") ) {
			event.keyCode = (options.charCode > 0) ? options.charCode : options.keyCode;
			event.charCode = undefined;
		}

		return event;
	},

	dispatchEvent: function( elem, type, event ) {
		if ( elem.dispatchEvent ) {
			elem.dispatchEvent( event );
		} else if ( type === "click" && elem.click && elem.nodeName.toLowerCase() === "input" ) {
			elem.click();
		} else if ( elem.fireEvent ) {
			elem.fireEvent( "on" + type, event );
		}
	},

	simulateFocus: function() {
		var focusinEvent,
			triggered = false,
			element = $( this.target );

		function trigger() {
			triggered = true;
		}

		element.bind( "focus", trigger );
		element[ 0 ].focus();

		if ( !triggered ) {
			focusinEvent = $.Event( "focusin" );
			focusinEvent.preventDefault();
			element.trigger( focusinEvent );
			element.triggerHandler( "focus" );
		}
		element.unbind( "focus", trigger );
	},

	simulateBlur: function() {
		var focusoutEvent,
			triggered = false,
			element = $( this.target );

		function trigger() {
			triggered = true;
		}

		element.bind( "blur", trigger );
		element[ 0 ].blur();

		// blur events are async in IE
		setTimeout(function() {
			// IE won't let the blur occur if the window is inactive
			if ( element[ 0 ].ownerDocument.activeElement === element[ 0 ] ) {
				element[ 0 ].ownerDocument.body.focus();
			}

			// Firefox won't trigger events if the window is inactive
			// IE doesn't trigger events if we had to manually focus the body
			if ( !triggered ) {
				focusoutEvent = $.Event( "focusout" );
				focusoutEvent.preventDefault();
				element.trigger( focusoutEvent );
				element.triggerHandler( "blur" );
			}
			element.unbind( "blur", trigger );
		}, 1 );
	}
});



/** complex events **/

function findCenter( elem ) {
	var offset,
		document = $( elem.ownerDocument );
	elem = $( elem );
	offset = elem.offset();

	return {
		x: offset.left + elem.outerWidth() / 2 - document.scrollLeft(),
		y: offset.top + elem.outerHeight() / 2 - document.scrollTop()
	};
}

function findCorner( elem ) {
	var offset,
		document = $( elem.ownerDocument );
	elem = $( elem );
	offset = elem.offset();

	return {
		x: offset.left - document.scrollLeft(),
		y: offset.top - document.scrollTop()
	};
}

$.extend( $.simulate.prototype, {
	simulateDrag: function() {
		var i = 0,
			target = this.target,
			eventDoc = target.ownerDocument,
			options = this.options,
			center = options.handle === "corner" ? findCorner( target ) : findCenter( target ),
			x = Math.floor( center.x ),
			y = Math.floor( center.y ),
			coord = { clientX: x, clientY: y },
			dx = options.dx || ( options.x !== undefined ? options.x - x : 0 ),
			dy = options.dy || ( options.y !== undefined ? options.y - y : 0 ),
			moves = options.moves || 3;

		this.simulateEvent( target, "mousedown", coord );

		for ( ; i < moves ; i++ ) {
			x += dx / moves;
			y += dy / moves;

			coord = {
				clientX: Math.round( x ),
				clientY: Math.round( y )
			};

			this.simulateEvent( eventDoc, "mousemove", coord );
		}

		if ( $.contains( eventDoc, target ) ) {
			this.simulateEvent( target, "mouseup", coord );
			this.simulateEvent( target, "click", coord );
		} else {
			this.simulateEvent( eventDoc, "mouseup", coord );
		}
	}
});

})( jQuery );

OSM.History = function (map) {
  const page = {};

  $("#sidebar_content")
    .on("click", ".changeset_more a", loadMore)
    .on("mouseover", "[data-changeset]", function () {
      highlightChangeset($(this).data("changeset").id);
    })
    .on("mouseout", "[data-changeset]", function () {
      unHighlightChangeset($(this).data("changeset").id);
    });

  const group = L.featureGroup()
    .on("mouseover", function (e) {
      highlightChangeset(e.layer.id);
    })
    .on("mouseout", function (e) {
      unHighlightChangeset(e.layer.id);
    })
    .on("click", function (e) {
      clickChangeset(e.layer.id, e.originalEvent);
    });

  group.getLayerId = function (layer) {
    return layer.id;
  };

  function highlightChangeset(id) {
    const layer = group.getLayer(id);
    if (layer) layer.setStyle({ fillOpacity: 0.3, color: "#FF6600", weight: 3 });
    $("#changeset_" + id).addClass("selected");
  }

  function unHighlightChangeset(id) {
    const layer = group.getLayer(id);
    if (layer) layer.setStyle({ fillOpacity: 0, color: "#FF9500", weight: 2 });
    $("#changeset_" + id).removeClass("selected");
  }

  function clickChangeset(id, e) {
    $("#changeset_" + id).find("a.changeset_id").simulate("click", e);
  }

  function displayFirstChangesets(html) {
    $("#sidebar_content .changesets").html(html);
  }

  function displayMoreChangesets(div, html) {
    const sidebar = $("#sidebar")[0];
    const previousScrollHeightMinusTop = sidebar.scrollHeight - sidebar.scrollTop;

    const oldList = $("#sidebar_content .changesets ol");

    div.replaceWith(html);

    const prevNewList = oldList.prevAll("ol");
    if (prevNewList.length) {
      prevNewList.next(".changeset_more").remove();
      prevNewList.children().prependTo(oldList);
      prevNewList.remove();

      // restore scroll position only if prepending
      sidebar.scrollTop = sidebar.scrollHeight - previousScrollHeightMinusTop;
    }

    const nextNewList = oldList.nextAll("ol");
    if (nextNewList.length) {
      nextNewList.prev(".changeset_more").remove();
      nextNewList.children().appendTo(oldList);
      nextNewList.remove();
    }
  }

  function update() {
    const data = new URLSearchParams();
    const params = new URLSearchParams(location.search);

    if (location.pathname === "/history") {
      data.set("bbox", map.getBounds().wrap().toBBoxString());
      const feedLink = $("link[type=\"application/atom+xml\"]"),
            feedHref = feedLink.attr("href").split("?")[0];
      feedLink.attr("href", feedHref + "?" + data);
    }

    data.set("list", "1");

    if (params.has("before")) {
      data.set("before", params.get("before"));
    }
    if (params.has("after")) {
      data.set("after", params.get("after"));
    }

    fetch(location.pathname + "?" + data)
      .then(response => response.text())
      .then(function (html) {
        displayFirstChangesets(html);
        updateMap();
      });
  }

  function loadMore(e) {
    e.preventDefault();
    e.stopPropagation();

    const div = $(this).parents(".changeset_more");

    $(this).hide();
    div.find(".loader").show();

    $.get($(this).attr("href"), function (html) {
      displayMoreChangesets(div, html);
      updateMap();
    });
  }

  let changesets = [];

  function updateBounds() {
    group.clearLayers();

    for (const changeset of changesets) {
      const bottomLeft = map.project(L.latLng(changeset.bbox.minlat, changeset.bbox.minlon)),
            topRight = map.project(L.latLng(changeset.bbox.maxlat, changeset.bbox.maxlon)),
            width = topRight.x - bottomLeft.x,
            height = bottomLeft.y - topRight.y,
            minSize = 20; // Min width/height of changeset in pixels

      if (width < minSize) {
        bottomLeft.x -= ((minSize - width) / 2);
        topRight.x += ((minSize - width) / 2);
      }

      if (height < minSize) {
        bottomLeft.y += ((minSize - height) / 2);
        topRight.y -= ((minSize - height) / 2);
      }

      changeset.bounds = L.latLngBounds(map.unproject(bottomLeft),
                                        map.unproject(topRight));
    }

    changesets.sort(function (a, b) {
      return b.bounds.getSize() - a.bounds.getSize();
    });

    for (const changeset of changesets) {
      const rect = L.rectangle(changeset.bounds,
                               { weight: 2, color: "#FF9500", opacity: 1, fillColor: "#FFFFAF", fillOpacity: 0 });
      rect.id = changeset.id;
      rect.addTo(group);
    }
  }

  function updateMap() {
    changesets = $("[data-changeset]").map(function (index, element) {
      return $(element).data("changeset");
    }).get().filter(function (changeset) {
      return changeset.bbox;
    });

    updateBounds();

    if (location.pathname !== "/history") {
      const bounds = group.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds);
    }
  }

  page.pushstate = page.popstate = function (path) {
    OSM.loadSidebarContent(path, page.load);
  };

  page.load = function () {
    map.addLayer(group);

    if (location.pathname === "/history") {
      map.on("moveend", update);
    }

    map.on("zoomend", updateBounds);

    update();
  };

  page.unload = function () {
    map.removeLayer(group);
    map.off("moveend", update);
    map.off("zoomend", updateBounds);
  };

  return page;
};
OSM.Note = function (map) {
  const content = $("#sidebar_content"),
        page = {};

  const noteIcons = {
    "new": L.icon({
      iconUrl: OSM.NEW_NOTE_MARKER,
      iconSize: [25, 40],
      iconAnchor: [12, 40]
    }),
    "open": L.icon({
      iconUrl: OSM.OPEN_NOTE_MARKER,
      iconSize: [25, 40],
      iconAnchor: [12, 40]
    }),
    "closed": L.icon({
      iconUrl: OSM.CLOSED_NOTE_MARKER,
      iconSize: [25, 40],
      iconAnchor: [12, 40]
    })
  };

  page.pushstate = page.popstate = function (path, id) {
    OSM.loadSidebarContent(path, function () {
      const data = $(".details").data();
      if (!data) return;
      const latLng = L.latLng(data.coordinates.split(","));
      initialize(path, id, map.getBounds().contains(latLng));
    });
  };

  page.load = function (path, id) {
    initialize(path, id);
  };

  function initialize(path, id, skipMoveToNote) {
    content.find("button[name]").on("click", function (e) {
      e.preventDefault();
      const { url, method } = $(e.target).data(),
            name = $(e.target).attr("name"),
            data = new URLSearchParams();
      content.find("button[name]").prop("disabled", true);

      if (name !== "subscribe" && name !== "unsubscribe" && name !== "reopen") {
        data.set("text", content.find("textarea").val());
      }

      fetch(url, {
        method: method,
        headers: { ...OSM.oauth },
        body: data
      })
        .then(response => {
          if (response.ok) return response;
          return response.text().then(text => {
            throw new Error(text);
          });
        })
        .then(() => {
          OSM.loadSidebarContent(path, () => {
            initialize(path, id, false);
          });
        })
        .catch(error => {
          content.find("#comment-error")
            .text(error.message)
            .prop("hidden", false)
            .get(0).scrollIntoView({ block: "nearest" });
          updateButtons();
        });
    });

    content.find("textarea").on("input", function (e) {
      updateButtons(e.target.form);
    });

    content.find("textarea").val("").trigger("input");

    const data = $(".details").data();

    if (data) {
      const hashParams = OSM.parseHash();
      map.addObject({
        type: "note",
        id: parseInt(id, 10),
        latLng: L.latLng(data.coordinates.split(",")),
        icon: noteIcons[data.status]
      }, function () {
        if (!hashParams.center && !skipMoveToNote) {
          const latLng = L.latLng(data.coordinates.split(","));
          OSM.router.withoutMoveListener(function () {
            map.setView(latLng, 15, { reset: true });
          });
        }
      });
    }
  }

  function updateButtons() {
    const resolveButton = content.find("button[name='close']");
    const commentButton = content.find("button[name='comment']");

    content.find("button[name]").prop("disabled", false);
    if (content.find("textarea").val() === "") {
      resolveButton.text(resolveButton.data("defaultActionText"));
      commentButton.prop("disabled", true);
    } else {
      resolveButton.text(resolveButton.data("commentActionText"));
    }
  }

  page.unload = function () {
    map.removeObject();
  };

  return page;
};
OSM.NewNote = function (map) {
  const noteLayer = map.noteLayer,
        content = $("#sidebar_content"),
        page = {},
        addNoteButton = $(".control-note .control-button");
  let newNoteMarker,
      halo;

  const noteIcons = {
    "new": L.icon({
      iconUrl: OSM.NEW_NOTE_MARKER,
      iconSize: [25, 40],
      iconAnchor: [12, 40]
    }),
    "open": L.icon({
      iconUrl: OSM.OPEN_NOTE_MARKER,
      iconSize: [25, 40],
      iconAnchor: [12, 40]
    }),
    "closed": L.icon({
      iconUrl: OSM.CLOSED_NOTE_MARKER,
      iconSize: [25, 40],
      iconAnchor: [12, 40]
    })
  };

  addNoteButton.on("click", function (e) {
    e.preventDefault();
    e.stopPropagation();

    if ($(this).hasClass("disabled")) return;

    OSM.router.route("/note/new");
  });

  function createNote(location, text, callback) {
    fetch("/api/0.6/notes.json", {
      method: "POST",
      headers: { ...OSM.oauth },
      body: new URLSearchParams({
        lat: location.lat,
        lon: location.lng,
        text
      })
    })
      .then(response => response.json())
      .then(callback);
  }

  function addCreatedNoteMarker(feature) {
    const marker = L.marker(feature.geometry.coordinates.reverse(), {
      icon: noteIcons[feature.properties.status],
      opacity: 0.9,
      interactive: true
    });
    marker.id = feature.properties.id;
    marker.addTo(noteLayer);
  }

  function addHalo(latlng) {
    if (halo) map.removeLayer(halo);

    halo = L.circleMarker(latlng, {
      weight: 2.5,
      radius: 20,
      fillOpacity: 0.5,
      color: "#FF6200"
    });

    map.addLayer(halo);
  }

  function removeHalo() {
    if (halo) map.removeLayer(halo);
    halo = null;
  }

  function addNewNoteMarker(latlng) {
    if (newNoteMarker) map.removeLayer(newNoteMarker);

    newNoteMarker = L.marker(latlng, {
      icon: noteIcons.new,
      opacity: 0.9,
      draggable: true
    });

    newNoteMarker.on("dragstart dragend", function (a) {
      removeHalo();
      if (a.type === "dragend") {
        addHalo(newNoteMarker.getLatLng());
      }
    });

    newNoteMarker.addTo(map);
    addHalo(newNoteMarker.getLatLng());

    newNoteMarker.on("dragend", function () {
      content.find("textarea").focus();
    });
  }

  function removeNewNoteMarker() {
    removeHalo();
    if (newNoteMarker) map.removeLayer(newNoteMarker);
    newNoteMarker = null;
  }

  function moveNewNotMarkerToClick(e) {
    if (newNoteMarker) newNoteMarker.setLatLng(e.latlng);
    if (halo) halo.setLatLng(e.latlng);
    content.find("textarea").focus();
  }

  function updateControls() {
    const zoomedOut = addNoteButton.hasClass("disabled");
    const withoutText = content.find("textarea").val() === "";

    content.find("#new-note-zoom-warning").prop("hidden", !zoomedOut);
    content.find("input[type=submit]").prop("disabled", zoomedOut || withoutText);
    if (newNoteMarker) newNoteMarker.setOpacity(zoomedOut ? 0.5 : 0.9);
  }

  page.pushstate = page.popstate = function (path) {
    OSM.loadSidebarContent(path, function () {
      page.load(path);
    });
  };

  page.load = function (path) {
    addNoteButton.addClass("active");

    map.addLayer(noteLayer);

    const params = new URLSearchParams(path.substring(path.indexOf("?")));
    let markerLatlng;

    if (params.has("lat") && params.has("lon")) {
      markerLatlng = L.latLng(params.get("lat"), params.get("lon"));
    } else {
      markerLatlng = map.getCenter();
    }

    map.panInside(markerLatlng, {
      padding: [50, 50]
    });

    addNewNoteMarker(markerLatlng);

    content.find("textarea")
      .on("input", updateControls)
      .focus();

    content.find("input[type=submit]").on("click", function (e) {
      const location = newNoteMarker.getLatLng().wrap();
      const text = content.find("textarea").val();

      e.preventDefault();
      $(this).prop("disabled", true);
      newNoteMarker.options.draggable = false;
      newNoteMarker.dragging.disable();

      createNote(location, text, (feature) => {
        if (typeof OSM.user === "undefined") {
          const anonymousNotesCount = Number(Cookies.get("_osm_anonymous_notes_count")) || 0;
          Cookies.set("_osm_anonymous_notes_count", anonymousNotesCount + 1, { secure: true, expires: 30, path: "/", samesite: "lax" });
        }
        content.find("textarea").val("");
        addCreatedNoteMarker(feature);
        OSM.router.route("/note/" + feature.properties.id);
      });
    });

    map.on("click", moveNewNotMarkerToClick);
    addNoteButton.on("disabled enabled", updateControls);
    updateControls();

    return map.getState();
  };

  page.unload = function () {
    map.off("click", moveNewNotMarkerToClick);
    addNoteButton.off("disabled enabled", updateControls);
    removeNewNoteMarker();
    addNoteButton.removeClass("active");
  };

  return page;
};
OSM.DirectionsEndpoint = function Endpoint(map, input, iconUrl, dragCallback, changeCallback) {
  const endpoint = {};

  endpoint.marker = L.marker([0, 0], {
    icon: L.icon({
      iconUrl: iconUrl,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowUrl: OSM.MARKER_SHADOW,
      shadowSize: [41, 41]
    }),
    draggable: true,
    autoPan: true
  });

  endpoint.enableListeners = function () {
    endpoint.marker.on("drag dragend", markerDragListener);
    input.on("keydown", inputKeydownListener);
    input.on("change", inputChangeListener);
  };

  endpoint.disableListeners = function () {
    endpoint.marker.off("drag dragend", markerDragListener);
    input.off("keydown", inputKeydownListener);
    input.off("change", inputChangeListener);
  };

  function markerDragListener(e) {
    const latlng = L.latLng(OSM.cropLocation(e.target.getLatLng(), map.getZoom()));

    if (endpoint.geocodeRequest) endpoint.geocodeRequest.abort();
    delete endpoint.geocodeRequest;

    setLatLng(latlng);
    setInputValueFromLatLng(latlng);
    endpoint.value = input.val();
    if (e.type === "dragend") getReverseGeocode();
    dragCallback(e.type === "drag");
  }

  function inputKeydownListener() {
    input.removeClass("is-invalid");
  }

  function inputChangeListener(e) {
    // make text the same in both text boxes
    const value = e.target.value;
    endpoint.setValue(value);
  }

  endpoint.setValue = function (value) {
    if (endpoint.geocodeRequest) endpoint.geocodeRequest.abort();
    delete endpoint.geocodeRequest;
    input.removeClass("is-invalid");

    const coordinatesMatch = value.match(/^\s*([+-]?\d+(?:\.\d*)?)(?:\s+|\s*[/,]\s*)([+-]?\d+(?:\.\d*)?)\s*$/);
    const latlng = coordinatesMatch && L.latLng(coordinatesMatch[1], coordinatesMatch[2]);

    if (latlng && endpoint.cachedReverseGeocode && endpoint.cachedReverseGeocode.latlng.equals(latlng)) {
      setLatLng(latlng);
      if (endpoint.cachedReverseGeocode.notFound) {
        endpoint.value = value;
        input.addClass("is-invalid");
      } else {
        endpoint.value = endpoint.cachedReverseGeocode.value;
      }
      input.val(endpoint.value);
      changeCallback();
      return;
    }

    endpoint.value = value;
    removeLatLng();
    input.val(value);

    if (latlng) {
      setLatLng(latlng);
      setInputValueFromLatLng(latlng);
      getReverseGeocode();
      changeCallback();
    } else if (endpoint.value) {
      getGeocode();
    }
  };

  endpoint.clearValue = function () {
    if (endpoint.geocodeRequest) endpoint.geocodeRequest.abort();
    delete endpoint.geocodeRequest;
    removeLatLng();
    delete endpoint.value;
    input.val("");
    map.removeLayer(endpoint.marker);
  };

  endpoint.swapCachedReverseGeocodes = function (otherEndpoint) {
    const g0 = endpoint.cachedReverseGeocode;
    const g1 = otherEndpoint.cachedReverseGeocode;
    delete endpoint.cachedReverseGeocode;
    delete otherEndpoint.cachedReverseGeocode;
    if (g0) otherEndpoint.cachedReverseGeocode = g0;
    if (g1) endpoint.cachedReverseGeocode = g1;
  };

  function getGeocode() {
    const viewbox = map.getBounds().toBBoxString(), // <sw lon>,<sw lat>,<ne lon>,<ne lat>
          geocodeUrl = OSM.NOMINATIM_URL + "search?" + new URLSearchParams({ q: endpoint.value, format: "json", viewbox });

    endpoint.geocodeRequest = new AbortController();
    fetch(geocodeUrl, { signal: endpoint.geocodeRequest.signal })
      .then(r => r.json())
      .then(success)
      .catch(() => {});

    function success(json) {
      delete endpoint.geocodeRequest;
      if (json.length === 0) {
        input.addClass("is-invalid");
        // eslint-disable-next-line no-alert
        alert(OSM.i18n.t("javascripts.directions.errors.no_place", { place: endpoint.value }));
        return;
      }

      setLatLng(L.latLng(json[0]));

      endpoint.value = json[0].display_name;
      input.val(json[0].display_name);

      changeCallback();
    }
  }

  function getReverseGeocode() {
    const latlng = endpoint.latlng.clone(),
          { lat, lng } = latlng,
          reverseGeocodeUrl = OSM.NOMINATIM_URL + "reverse?" + new URLSearchParams({ lat, lon: lng, format: "json" });

    endpoint.geocodeRequest = new AbortController();
    fetch(reverseGeocodeUrl, { signal: endpoint.geocodeRequest.signal })
      .then(r => r.json())
      .then(success)
      .catch(() => {});

    function success(json) {
      delete endpoint.geocodeRequest;
      if (!json || !json.display_name) {
        endpoint.cachedReverseGeocode = { latlng: latlng, notFound: true };
        return;
      }

      endpoint.value = json.display_name;
      input.val(json.display_name);
      endpoint.cachedReverseGeocode = { latlng: latlng, value: endpoint.value };
    }
  }

  function setLatLng(ll) {
    input
      .attr("data-lat", ll.lat)
      .attr("data-lon", ll.lng);
    endpoint.latlng = ll;
    endpoint.marker
      .setLatLng(ll)
      .addTo(map);
  }

  function removeLatLng() {
    input
      .removeAttr("data-lat")
      .removeAttr("data-lon");
    delete endpoint.latlng;
  }

  function setInputValueFromLatLng(latlng) {
    input.val(latlng.lat + ", " + latlng.lng);
  }

  return endpoint;
};




OSM.Directions = function (map) {
  let controller = null; // the AbortController for the current route request if a route request is in progress
  let lastLocation = [];
  let chosenEngine;

  const popup = L.popup({ autoPanPadding: [100, 100] });

  const polyline = L.polyline([], {
    color: "#03f",
    opacity: 0.3,
    weight: 10
  });

  const highlight = L.polyline([], {
    color: "#ff0",
    opacity: 0.5,
    weight: 12
  });

  const endpointDragCallback = function (dragging) {
    if (!map.hasLayer(polyline)) return;
    if (dragging && !chosenEngine.draggable) return;
    if (dragging && controller) return;

    getRoute(false, !dragging);
  };
  const endpointChangeCallback = function () {
    getRoute(true, true);
  };

  const endpoints = [
    OSM.DirectionsEndpoint(map, $("input[name='route_from']"), OSM.MARKER_GREEN, endpointDragCallback, endpointChangeCallback),
    OSM.DirectionsEndpoint(map, $("input[name='route_to']"), OSM.MARKER_RED, endpointDragCallback, endpointChangeCallback)
  ];

  let downloadURL = null;

  const expiry = new Date();
  expiry.setYear(expiry.getFullYear() + 10);

  const modeGroup = $(".routing_modes");
  const select = $("select.routing_engines");

  $(".directions_form .reverse_directions").on("click", function () {
    const coordFrom = endpoints[0].latlng,
          coordTo = endpoints[1].latlng;
    let routeFrom = "",
        routeTo = "";
    if (coordFrom) {
      routeFrom = coordFrom.lat + "," + coordFrom.lng;
    }
    if (coordTo) {
      routeTo = coordTo.lat + "," + coordTo.lng;
    }
    endpoints[0].swapCachedReverseGeocodes(endpoints[1]);

    OSM.router.route("/directions?" + new URLSearchParams({
      route: routeTo + ";" + routeFrom
    }));
  });

  $(".directions_form .btn-close").on("click", function (e) {
    e.preventDefault();
    $(".describe_location").toggle(!endpoints[1].value);
    $(".search_form input[name='query']").val(endpoints[1].value);
    OSM.router.route("/" + OSM.formatHash(map));
  });

  function formatTotalDistance(m) {
    if (m < 1000) {
      return OSM.i18n.t("javascripts.directions.distance_m", { distance: Math.round(m) });
    } else if (m < 10000) {
      return OSM.i18n.t("javascripts.directions.distance_km", { distance: (m / 1000.0).toFixed(1) });
    } else {
      return OSM.i18n.t("javascripts.directions.distance_km", { distance: Math.round(m / 1000) });
    }
  }

  function formatStepDistance(m) {
    if (m < 5) {
      return "";
    } else if (m < 200) {
      return OSM.i18n.t("javascripts.directions.distance_m", { distance: String(Math.round(m / 10) * 10) });
    } else if (m < 1500) {
      return OSM.i18n.t("javascripts.directions.distance_m", { distance: String(Math.round(m / 100) * 100) });
    } else if (m < 5000) {
      return OSM.i18n.t("javascripts.directions.distance_km", { distance: String(Math.round(m / 100) / 10) });
    } else {
      return OSM.i18n.t("javascripts.directions.distance_km", { distance: String(Math.round(m / 1000)) });
    }
  }

  function formatHeight(m) {
    return OSM.i18n.t("javascripts.directions.distance_m", { distance: Math.round(m) });
  }

  function formatTime(s) {
    let m = Math.round(s / 60);
    const h = Math.floor(m / 60);
    m -= h * 60;
    return h + ":" + (m < 10 ? "0" : "") + m;
  }

  function setEngine(id) {
    const engines = OSM.Directions.engines;
    const desired = engines.find(engine => engine.id === id);
    if (!desired || (chosenEngine && chosenEngine.id === id)) return;
    chosenEngine = desired;

    const modes = engines
      .filter(engine => engine.provider === chosenEngine.provider)
      .map(engine => engine.mode);
    modeGroup
      .find("input[id]")
      .prop("disabled", function () {
        return !modes.includes(this.id);
      })
      .prop("checked", function () {
        return this.id === chosenEngine.mode;
      });

    const providers = engines
      .filter(engine => engine.mode === chosenEngine.mode)
      .map(engine => engine.provider);
    select
      .find("option[value]")
      .prop("disabled", function () {
        return !providers.includes(this.value);
      });
    select.val(chosenEngine.provider);
  }

  function getRoute(fitRoute, reportErrors) {
    // Cancel any route that is already in progress
    if (controller) controller.abort();

    const points = endpoints.map(p => p.latlng);

    if (!points[0] || !points[1]) return;
    $("header").addClass("closed");

    OSM.router.replace("/directions?" + new URLSearchParams({
      engine: chosenEngine.id,
      route: points.map(p => `${p.lat},${p.lng}`).join(";")
    }));

    // copy loading item to sidebar and display it. we copy it, rather than
    // just using it in-place and replacing it in case it has to be used
    // again.
    $("#directions_content").html($(".directions_form .loader_copy").html());
    map.setSidebarOverlaid(false);
    controller = new AbortController();
    chosenEngine.getRoute(points, controller.signal).then(function (route) {
      polyline
        .setLatLngs(route.line)
        .addTo(map);

      if (fitRoute) {
        map.fitBounds(polyline.getBounds().pad(0.05));
      }

      const distanceText = $("<p>").append(
        OSM.i18n.t("javascripts.directions.distance") + ": " + formatTotalDistance(route.distance) + ". " +
        OSM.i18n.t("javascripts.directions.time") + ": " + formatTime(route.time) + ".");
      if (typeof route.ascend !== "undefined" && typeof route.descend !== "undefined") {
        distanceText.append(
          $("<br>"),
          OSM.i18n.t("javascripts.directions.ascend") + ": " + formatHeight(route.ascend) + ". " +
          OSM.i18n.t("javascripts.directions.descend") + ": " + formatHeight(route.descend) + ".");
      }

      const turnByTurnTable = $("<table class='table table-hover table-sm mb-3'>")
        .append($("<tbody>"));

      $("#directions_content")
        .empty()
        .append(
          distanceText,
          turnByTurnTable
        );

      // Add each row
      route.steps.forEach(function (step) {
        const [ll, direction, instruction, dist, lineseg] = step;

        const row = $("<tr class='turn'/>");
        if (direction) {
          row.append("<td class='border-0'><svg width='20' height='20' class='d-block'><use href='#routing-sprite-" + direction + "' /></svg></td>");
        } else {
          row.append("<td class='border-0'>");
        }
        row.append("<td>" + instruction);
        row.append("<td class='distance text-body-secondary text-end'>" + formatStepDistance(dist));

        row.on("click", function () {
          popup
            .setLatLng(ll)
            .setContent("<p>" + instruction + "</p>")
            .openOn(map);
        });

        row.hover(function () {
          highlight
            .setLatLngs(lineseg)
            .addTo(map);
        }, function () {
          map.removeLayer(highlight);
        });

        turnByTurnTable.append(row);
      });

      const blob = new Blob([JSON.stringify(polyline.toGeoJSON())], { type: "application/json" });
      URL.revokeObjectURL(downloadURL);
      downloadURL = URL.createObjectURL(blob);

      $("#directions_content").append(`<p class="text-center"><a href="${downloadURL}" download="${
        OSM.i18n.t("javascripts.directions.filename")
      }">${
        OSM.i18n.t("javascripts.directions.download")
      }</a></p>`);

      $("#directions_content").append("<p class=\"text-center\">" +
        OSM.i18n.t("javascripts.directions.instructions.courtesy", { link: chosenEngine.creditline }) +
        "</p>");
    }).catch(function () {
      map.removeLayer(polyline);
      if (reportErrors) {
        $("#directions_content").html("<div class=\"alert alert-danger\">" + OSM.i18n.t("javascripts.directions.errors.no_route") + "</div>");
      }
    }).finally(function () {
      controller = null;
    });
  }

  function hideRoute(e) {
    e.stopPropagation();
    map.removeLayer(polyline);
    $("#directions_content").html("");
    popup.close();
    map.setSidebarOverlaid(true);
    // TODO: collapse width of sidebar back to previous
  }

  setEngine("fossgis_osrm_car");
  setEngine(Cookies.get("_osm_directions_engine"));

  modeGroup.on("change", "input[name='modes']", function (e) {
    setEngine(chosenEngine.provider + "_" + e.target.id);
    Cookies.set("_osm_directions_engine", chosenEngine.id, { secure: true, expires: expiry, path: "/", samesite: "lax" });
    getRoute(true, true);
  });

  select.on("change", function (e) {
    setEngine(e.target.value + "_" + chosenEngine.mode);
    Cookies.set("_osm_directions_engine", chosenEngine.id, { secure: true, expires: expiry, path: "/", samesite: "lax" });
    getRoute(true, true);
  });

  $(".directions_form").on("submit", function (e) {
    e.preventDefault();
    getRoute(true, true);
  });

  $(".routing_marker_column img").on("dragstart", function (e) {
    const dt = e.originalEvent.dataTransfer;
    dt.effectAllowed = "move";
    const dragData = { type: $(this).data("type") };
    dt.setData("text", JSON.stringify(dragData));
    if (dt.setDragImage) {
      const img = $("<img>").attr("src", $(e.originalEvent.target).attr("src"));
      dt.setDragImage(img.get(0), 12, 21);
    }
  });

  function sendstartinglocation({ latlng: { lat, lng } }) {
    map.fire("startinglocation", { latlng: [lat, lng] });
  }

  function startingLocationListener({ latlng }) {
    if (endpoints[0].value) return;
    endpoints[0].setValue(latlng.join(", "));
  }

  map.on("locationfound", ({ latlng: { lat, lng } }) =>
    lastLocation = [lat, lng]
  ).on("locateactivate", () => {
    map.once("startinglocation", startingLocationListener);
  });

  function initializeFromParams() {
    const params = new URLSearchParams(location.search),
          route = (params.get("route") || "").split(";");

    if (params.has("engine")) setEngine(params.get("engine"));

    endpoints[0].setValue(params.get("from") || route[0] || lastLocation.join(", "));
    endpoints[1].setValue(params.get("to") || route[1] || "");
  }

  function enableListeners() {
    $("#sidebar .sidebar-close-controls button").on("click", hideRoute);

    $("#map").on("dragend dragover", function (e) {
      e.preventDefault();
    });

    $("#map").on("drop", function (e) {
      e.preventDefault();
      const oe = e.originalEvent;
      const dragData = JSON.parse(oe.dataTransfer.getData("text"));
      const type = dragData.type;
      const pt = L.DomEvent.getMousePosition(oe, map.getContainer()); // co-ordinates of the mouse pointer at present
      pt.y += 20;
      const ll = map.containerPointToLatLng(pt);
      const llWithPrecision = OSM.cropLocation(ll, map.getZoom());
      endpoints[type === "from" ? 0 : 1].setValue(llWithPrecision.join(", "));
    });

    map.on("locationfound", sendstartinglocation);

    endpoints[0].enableListeners();
    endpoints[1].enableListeners();
  }

  const page = {};

  page.pushstate = page.popstate = function () {
    if ($("#directions_content").length) {
      page.load();
    } else {
      initializeFromParams();

      $(".search_form").hide();
      $(".directions_form").show();

      OSM.loadSidebarContent("/directions", enableListeners);

      map.setSidebarOverlaid(!endpoints[0].latlng || !endpoints[1].latlng);
    }
  };

  page.load = function () {
    initializeFromParams();

    $(".search_form").hide();
    $(".directions_form").show();

    enableListeners();

    map.setSidebarOverlaid(!endpoints[0].latlng || !endpoints[1].latlng);
  };

  page.unload = function () {
    $(".search_form").show();
    $(".directions_form").hide();

    $("#sidebar .sidebar-close-controls button").off("click", hideRoute);
    $("#map").off("dragend dragover drop");
    map.off("locationfound", sendstartinglocation);

    endpoints[0].disableListeners();
    endpoints[1].disableListeners();

    endpoints[0].clearValue();
    endpoints[1].clearValue();

    map
      .removeLayer(popup)
      .removeLayer(polyline);
  };

  return page;
};

OSM.Directions.engines = [];

OSM.Directions.addEngine = function (engine, supportsHTTPS) {
  if (location.protocol === "http:" || supportsHTTPS) {
    engine.id = engine.provider + "_" + engine.mode;
    OSM.Directions.engines.push(engine);
  }
};
// OSRM engine
// Doesn't yet support hints

(function () {
  function FOSSGISOSRMEngine(modeId, vehicleType) {
    let cachedHints = [];

    function _processDirections(route) {
      const INSTRUCTION_TEMPLATE = {
        "continue": "continue",
        "merge right": "merge_right",
        "merge left": "merge_left",
        "off ramp right": "offramp_right",
        "off ramp left": "offramp_left",
        "on ramp right": "onramp_right",
        "on ramp left": "onramp_left",
        "fork right": "fork_right",
        "fork left": "fork_left",
        "end of road right": "endofroad_right",
        "end of road left": "endofroad_left",
        "turn straight": "continue",
        "turn slight right": "slight_right",
        "turn right": "turn_right",
        "turn sharp right": "sharp_right",
        "turn uturn": "uturn",
        "turn sharp left": "sharp_left",
        "turn left": "turn_left",
        "turn slight left": "slight_left",
        "roundabout": "roundabout",
        "rotary": "roundabout",
        "exit roundabout": "exit_roundabout",
        "exit rotary": "exit_roundabout",
        "depart": "start",
        "arrive": "destination"
      };
      const ICON_MAP = {
        "continue": "straight",
        "merge right": "merge-right",
        "merge left": "merge-left",
        "off ramp right": "exit-right",
        "off ramp left": "exit-left",
        "on ramp right": "right",
        "on ramp left": "left",
        "fork right": "fork-right",
        "fork left": "fork-left",
        "end of road right": "end-of-road-right",
        "end of road left": "end-of-road-left",
        "turn straight": "straight",
        "turn slight right": "slight-right",
        "turn right": "right",
        "turn sharp right": "sharp-right",
        "turn uturn": "u-turn-left",
        "turn slight left": "slight-left",
        "turn left": "left",
        "turn sharp left": "sharp-left",
        "roundabout": "roundabout",
        "rotary": "roundabout",
        "exit roundabout": "roundabout",
        "exit rotary": "roundabout",
        "depart": "start",
        "arrive": "destination"
      };
      function numToWord(num) {
        return ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][num - 1];
      }
      function getManeuverId(maneuver) {
        // special case handling
        switch (maneuver.type) {
          case "on ramp":
          case "off ramp":
          case "merge":
          case "end of road":
          case "fork":
            return maneuver.type + " " + (maneuver.modifier.indexOf("left") >= 0 ? "left" : "right");
          case "depart":
          case "arrive":
          case "roundabout":
          case "rotary":
          case "exit roundabout":
          case "exit rotary":
            return maneuver.type;
          case "roundabout turn":
          case "turn":
            return "turn " + maneuver.modifier;
            // for unknown types the fallback is turn
          default:
            return "turn " + maneuver.modifier;
        }
      }

      const steps = route.legs.flatMap(
        leg => leg.steps.map(function (step, idx) {
          const maneuver_id = getManeuverId(step.maneuver);

          const instrPrefix = "javascripts.directions.instructions.";
          let template = instrPrefix + INSTRUCTION_TEMPLATE[maneuver_id];

          const step_geometry = L.PolylineUtil.decode(step.geometry, { precision: 5 }).map(L.latLng);

          let instText = "<b>" + (idx + 1) + ".</b> ";
          const destinations = "<b>" + step.destinations + "</b>";
          let namedRoad = true;
          let name;

          if (step.name && step.ref) {
            name = "<b>" + step.name + " (" + step.ref + ")</b>";
          } else if (step.name) {
            name = "<b>" + step.name + "</b>";
          } else if (step.ref) {
            name = "<b>" + step.ref + "</b>";
          } else {
            name = OSM.i18n.t(instrPrefix + "unnamed");
            namedRoad = false;
          }

          if (step.maneuver.type.match(/^exit (rotary|roundabout)$/)) {
            instText += OSM.i18n.t(template, { name: name });
          } else if (step.maneuver.type.match(/^(rotary|roundabout)$/)) {
            if (step.maneuver.exit) {
              if (step.maneuver.exit <= 10) {
                instText += OSM.i18n.t(template + "_with_exit_ordinal", { exit: OSM.i18n.t(instrPrefix + "exit_counts." + numToWord(step.maneuver.exit)), name: name });
              } else {
                instText += OSM.i18n.t(template + "_with_exit", { exit: step.maneuver.exit, name: name });
              }
            } else {
              instText += OSM.i18n.t(template + "_without_exit", { name: name });
            }
          } else if (step.maneuver.type.match(/^(on ramp|off ramp)$/)) {
            const params = {};
            if (step.exits && step.maneuver.type.match(/^(off ramp)$/)) params.exit = step.exits;
            if (step.destinations) params.directions = destinations;
            if (namedRoad) params.directions = name;
            if (Object.keys(params).length > 0) {
              template = template + "_with_" + Object.keys(params).join("_");
            }
            instText += OSM.i18n.t(template, params);
          } else {
            instText += OSM.i18n.t(template + "_without_exit", { name: name });
          }
          return [[step.maneuver.location[1], step.maneuver.location[0]], ICON_MAP[maneuver_id], instText, step.distance, step_geometry];
        })
      );

      return {
        line: steps.flatMap(step => step[4]),
        steps,
        distance: route.distance,
        time: route.duration
      };
    }

    return {
      mode: modeId,
      provider: "fossgis_osrm",
      creditline: "<a href=\"https://routing.openstreetmap.de/about.html\" target=\"_blank\">OSRM (FOSSGIS)</a>",
      draggable: true,

      getRoute: function (points, signal) {
        const query = new URLSearchParams({
          overview: "false",
          geometries: "polyline",
          steps: true
        });

        if (cachedHints.length === points.length) {
          query.set("hints", cachedHints.join(";"));
        } else {
          // invalidate cache
          cachedHints = [];
        }

        const req_path = "routed-" + vehicleType + "/route/v1/driving/" + points.map(p => p.lng + "," + p.lat).join(";");

        return fetch(OSM.FOSSGIS_OSRM_URL + req_path + "?" + query, { signal })
          .then(response => response.json())
          .then(response => {
            if (response.code !== "Ok") throw new Error();
            cachedHints = response.waypoints.map(wp => wp.hint);
            return _processDirections(response.routes[0]);
          });
      }
    };
  }

  OSM.Directions.addEngine(new FOSSGISOSRMEngine("car", "car"), true);
  OSM.Directions.addEngine(new FOSSGISOSRMEngine("bicycle", "bike"), true);
  OSM.Directions.addEngine(new FOSSGISOSRMEngine("foot", "foot"), true);
}());
(function () {
  function FOSSGISValhallaEngine(modeId, costing) {
    const INSTR_MAP = [
      "straight", // kNone = 0;
      "start", // kStart = 1;
      "start", // kStartRight = 2;
      "start", // kStartLeft = 3;
      "destination", // kDestination = 4;
      "destination", // kDestinationRight = 5;
      "destination", // kDestinationLeft = 6;
      "straight", // kBecomes = 7;
      "straight", // kContinue = 8;
      "slight-right", // kSlightRight = 9;
      "right", // kRight = 10;
      "sharp-right", // kSharpRight = 11;
      "u-turn-right", // kUturnRight = 12;
      "u-turn-left", // kUturnLeft = 13;
      "sharp-left", // kSharpLeft = 14;
      "left", // kLeft = 15;
      "slight-left", // kSlightLeft = 16;
      "straight", // kRampStraight = 17;
      "exit-right", // kRampRight = 18;
      "exit-left", // kRampLeft = 19;
      "exit-right", // kExitRight = 20;
      "exit-left", // kExitLeft = 21;
      "straight", // kStayStraight = 22;
      "slight-right", // kStayRight = 23;
      "slight-left", // kStayLeft = 24;
      "merge-left", // kMerge = 25;
      "roundabout", // kRoundaboutEnter = 26;
      "roundabout", // kRoundaboutExit = 27;
      "ferry", // kFerryEnter = 28;
      "straight", // kFerryExit = 29;
      null, // kTransit = 30;
      null, // kTransitTransfer = 31;
      null, // kTransitRemainOn = 32;
      null, // kTransitConnectionStart = 33;
      null, // kTransitConnectionTransfer = 34;
      null, // kTransitConnectionDestination = 35;
      null, // kPostTransitConnectionDestination = 36;
      "merge-right", // kMergeRight = 37;
      "merge-left" // kMergeLeft = 38;
    ];

    function _processDirections(tripLegs) {
      let line = [];
      let steps = [];
      let distance = 0;
      let time = 0;

      for (const leg of tripLegs) {
        const legLine = L.PolylineUtil.decode(leg.shape, {
          precision: 6
        });

        const legSteps = leg.maneuvers.map(function (manoeuvre, idx) {
          const num = `<b>${idx + 1}.</b> `;
          const lineseg = legLine
            .slice(manoeuvre.begin_shape_index, manoeuvre.end_shape_index + 1)
            .map(([lat, lng]) => ({ lat, lng }));
          return [
            lineseg[0],
            INSTR_MAP[manoeuvre.type],
            num + manoeuvre.instruction,
            manoeuvre.length * 1000,
            lineseg
          ];
        });

        line = line.concat(legLine);
        steps = steps.concat(legSteps);
        distance += leg.summary.length;
        time += leg.summary.time;
      }

      return {
        line: line,
        steps: steps,
        distance: distance * 1000,
        time: time
      };
    }

    return {
      mode: modeId,
      provider: "fossgis_valhalla",
      creditline:
      "<a href='https://gis-ops.com/global-open-valhalla-server-online/' target='_blank'>Valhalla (FOSSGIS)</a>",
      draggable: false,

      getRoute: function (points, signal) {
        const query = new URLSearchParams({
          json: JSON.stringify({
            locations: points.map(function (p) {
              return { lat: p.lat, lon: p.lng, radius: 5 };
            }),
            costing: costing,
            directions_options: {
              units: "km",
              language: OSM.i18n.locale
            }
          })
        });
        return fetch(OSM.FOSSGIS_VALHALLA_URL + "?" + query, { signal })
          .then(response => response.json())
          .then(({ trip }) => {
            if (trip.status !== 0) throw new Error();
            return _processDirections(trip.legs);
          });
      }
    };
  }

  OSM.Directions.addEngine(new FOSSGISValhallaEngine("car", "auto"), true);
  OSM.Directions.addEngine(new FOSSGISValhallaEngine("bicycle", "bicycle"), true);
  OSM.Directions.addEngine(new FOSSGISValhallaEngine("foot", "pedestrian"), true);
}());
(function () {
  function GraphHopperEngine(modeId, vehicleType) {
    const GH_INSTR_MAP = {
      "-3": "sharp-left",
      "-2": "left",
      "-1": "slight-left",
      "0": "straight",
      "1": "slight-right",
      "2": "right",
      "3": "sharp-right",
      "4": "destination", // finish reached
      "5": "destination", // via reached
      "6": "roundabout",
      "-7": "fork-left",
      "7": "fork-right",
      "-98": "u-turn-left", // unknown direction u-turn
      "-8": "u-turn-left", // left u-turn
      "8": "u-turn-right" // right u-turn
    };

    function _processDirections(path) {
      const line = L.PolylineUtil.decode(path.points);

      const steps = path.instructions.map(function (instr, i) {
        const num = `<b>${i + 1}.</b> `;
        const lineseg = line
          .slice(instr.interval[0], instr.interval[1] + 1)
          .map(([lat, lng]) => ({ lat, lng }));
        return [
          lineseg[0],
          GH_INSTR_MAP[instr.sign],
          num + instr.text,
          instr.distance,
          lineseg
        ]; // TODO does graphhopper map instructions onto line indices?
      });
      steps.at(-1)[1] = "destination";

      return {
        line: line,
        steps: steps,
        distance: path.distance,
        time: path.time / 1000,
        ascend: path.ascend,
        descend: path.descend
      };
    }

    return {
      mode: modeId,
      provider: "graphhopper",
      creditline: "<a href=\"https://www.graphhopper.com/\" target=\"_blank\">GraphHopper</a>",
      draggable: false,

      getRoute: function (points, signal) {
        // GraphHopper Directions API documentation
        // https://graphhopper.com/api/1/docs/routing/
        const query = new URLSearchParams({
          vehicle: vehicleType,
          locale: OSM.i18n.locale,
          key: "LijBPDQGfu7Iiq80w3HzwB4RUDJbMbhs6BU0dEnn",
          elevation: false,
          instructions: true,
          turn_costs: vehicleType === "car"
        });
        points.forEach(p => query.append("point", p.lat + "," + p.lng));
        return fetch(OSM.GRAPHHOPPER_URL + "?" + query, { signal })
          .then(response => response.json())
          .then(({ paths }) => {
            if (!paths || paths.length === 0) throw new Error();
            return _processDirections(paths[0]);
          });
      }
    };
  }

  OSM.Directions.addEngine(new GraphHopperEngine("car", "car"), true);
  OSM.Directions.addEngine(new GraphHopperEngine("bicycle", "bike"), true);
  OSM.Directions.addEngine(new GraphHopperEngine("foot", "foot"), true);
}());
OSM.Changeset = function (map) {
  const page = {},
        content = $("#sidebar_content");

  page.pushstate = page.popstate = function (path) {
    OSM.loadSidebarContent(path, function () {
      page.load();
    });
  };

  page.load = function () {
    const changesetData = content.find("[data-changeset]").data("changeset");
    changesetData.type = "changeset";

    const hashParams = OSM.parseHash();
    initialize();
    map.addObject(changesetData, function (bounds) {
      if (!hashParams.center && bounds.isValid()) {
        OSM.router.withoutMoveListener(function () {
          map.fitBounds(bounds);
        });
      }
    });
  };

  function updateChangeset(method, url, include_data) {
    const data = new URLSearchParams();

    content.find("#comment-error").prop("hidden", true);
    content.find("button[data-method][data-url]").prop("disabled", true);

    if (include_data) {
      data.set("text", content.find("textarea").val());
    }

    fetch(url, {
      method: method,
      headers: { ...OSM.oauth },
      body: data
    })
      .then(response => {
        if (response.ok) return response;
        return response.text().then(text => {
          throw new Error(text);
        });
      })
      .then(() => {
        OSM.loadSidebarContent(location.pathname, page.load);
      })
      .catch(error => {
        content.find("button[data-method][data-url]").prop("disabled", false);
        content.find("#comment-error")
          .text(error.message)
          .prop("hidden", false)
          .get(0).scrollIntoView({ block: "nearest" });
      });
  }

  function initialize() {
    content.find("button[data-method][data-url]").on("click", function (e) {
      e.preventDefault();
      const data = $(e.target).data();
      const include_data = e.target.name === "comment";
      updateChangeset(data.method, data.url, include_data);
    });

    content.find("textarea").on("input", function (e) {
      const form = e.target.form,
            disabled = $(e.target).val() === "";
      form.comment.disabled = disabled;
    });

    content.find("textarea").val("").trigger("input");
  }

  page.unload = function () {
    map.removeObject();
  };

  return page;
};
OSM.Query = function (map) {
  const url = OSM.OVERPASS_URL,
        credentials = OSM.OVERPASS_CREDENTIALS,
        queryButton = $(".control-query .control-button"),
        uninterestingTags = ["source", "source_ref", "source:ref", "history", "attribution", "created_by", "tiger:county", "tiger:tlid", "tiger:upload_uuid", "KSJ2:curve_id", "KSJ2:lat", "KSJ2:lon", "KSJ2:coordinate", "KSJ2:filename", "note:ja"];
  let marker;

  const featureStyle = {
    color: "#FF6200",
    weight: 4,
    opacity: 1,
    fillOpacity: 0.5,
    interactive: false
  };

  queryButton.on("click", function (e) {
    e.preventDefault();
    e.stopPropagation();

    if (queryButton.hasClass("active")) {
      disableQueryMode();
    } else if (!queryButton.hasClass("disabled")) {
      enableQueryMode();
    }
  }).on("disabled", function () {
    if (queryButton.hasClass("active")) {
      map.off("click", clickHandler);
      $(map.getContainer()).removeClass("query-active").addClass("query-disabled");
      $(this).tooltip("show");
    }
  }).on("enabled", function () {
    if (queryButton.hasClass("active")) {
      map.on("click", clickHandler);
      $(map.getContainer()).removeClass("query-disabled").addClass("query-active");
      $(this).tooltip("hide");
    }
  });

  function showResultGeometry() {
    const geometry = $(this).data("geometry");
    if (geometry) map.addLayer(geometry);
    $(this).addClass("selected");
  }

  function hideResultGeometry() {
    const geometry = $(this).data("geometry");
    if (geometry) map.removeLayer(geometry);
    $(this).removeClass("selected");
  }

  $("#sidebar_content")
    .on("mouseover", ".query-results a", showResultGeometry)
    .on("mouseout", ".query-results a", hideResultGeometry);

  function interestingFeature(feature) {
    if (feature.tags) {
      for (const key in feature.tags) {
        if (uninterestingTags.indexOf(key) < 0) {
          return true;
        }
      }
    }

    return false;
  }

  function featurePrefix(feature) {
    const tags = feature.tags;
    let prefix = "";

    if (tags.boundary === "administrative" && (tags.border_type || tags.admin_level)) {
      prefix = OSM.i18n.t("geocoder.search_osm_nominatim.border_types." + tags.border_type, {
        defaultValue: OSM.i18n.t("geocoder.search_osm_nominatim.admin_levels.level" + tags.admin_level, {
          defaultValue: OSM.i18n.t("geocoder.search_osm_nominatim.prefix.boundary.administrative")
        })
      });
    } else {
      const prefixes = OSM.i18n.t("geocoder.search_osm_nominatim.prefix");

      for (const key in tags) {
        const value = tags[key];

        if (prefixes[key]) {
          if (prefixes[key][value]) {
            return prefixes[key][value];
          }
        }
      }

      for (const key in tags) {
        const value = tags[key];

        if (prefixes[key]) {
          const first = value.slice(0, 1).toUpperCase(),
                rest = value.slice(1).replace(/_/g, " ");

          return first + rest;
        }
      }
    }

    if (!prefix) {
      prefix = OSM.i18n.t("javascripts.query." + feature.type);
    }

    return prefix;
  }

  function featureName(feature) {
    const tags = feature.tags,
          locales = OSM.preferred_languages;

    for (const locale of locales) {
      if (tags["name:" + locale]) {
        return tags["name:" + locale];
      }
    }

    for (const key of ["name", "ref", "addr:housename"]) {
      if (tags[key]) {
        return tags[key];
      }
    }

    if (tags["addr:housenumber"] && tags["addr:street"]) {
      return tags["addr:housenumber"] + " " + tags["addr:street"];
    }
    return "#" + feature.id;
  }

  function featureGeometry(feature) {
    let geometry;

    if (feature.type === "node" && feature.lat && feature.lon) {
      geometry = L.circleMarker([feature.lat, feature.lon], featureStyle);
    } else if (feature.type === "way" && feature.geometry && feature.geometry.length > 0) {
      geometry = L.polyline(feature.geometry.filter(function (point) {
        return point !== null;
      }).map(function (point) {
        return [point.lat, point.lon];
      }), featureStyle);
    } else if (feature.type === "relation" && feature.members) {
      geometry = L.featureGroup(feature.members.map(featureGeometry).filter(function (geometry) {
        return typeof geometry !== "undefined";
      }));
    }

    return geometry;
  }

  function runQuery(latlng, radius, query, $section, merge, compare) {
    const $ul = $section.find("ul");

    $ul.empty();
    $section.show();

    if ($section.data("ajax")) {
      $section.data("ajax").abort();
    }

    $section.data("ajax", new AbortController());
    fetch(url, {
      method: "POST",
      body: new URLSearchParams({
        data: "[timeout:10][out:json];" + query
      }),
      credentials: credentials ? "include" : "same-origin",
      signal: $section.data("ajax").signal
    })
      .then(response => response.json())
      .then(function (results) {
        let elements;

        $section.find(".loader").hide();

        if (merge) {
          elements = results.elements.reduce(function (hash, element) {
            const key = element.type + element.id;
            if ("geometry" in element) {
              delete element.bounds;
            }
            hash[key] = $.extend({}, hash[key], element);
            return hash;
          }, {});

          elements = Object.keys(elements).map(function (key) {
            return elements[key];
          });
        } else {
          elements = results.elements;
        }

        if (compare) {
          elements = elements.sort(compare);
        }

        for (const element of elements) {
          if (!interestingFeature(element)) continue;

          const $li = $("<li>")
            .addClass("list-group-item list-group-item-action")
            .text(featurePrefix(element) + " ")
            .appendTo($ul);

          $("<a>")
            .addClass("stretched-link")
            .attr("href", "/" + element.type + "/" + element.id)
            .data("geometry", featureGeometry(element))
            .text(featureName(element))
            .appendTo($li);
        }

        if (results.remark) {
          $("<li>")
            .addClass("list-group-item")
            .text(OSM.i18n.t("javascripts.query.error", { server: url, error: results.remark }))
            .appendTo($ul);
        }

        if ($ul.find("li").length === 0) {
          $("<li>")
            .addClass("list-group-item")
            .text(OSM.i18n.t("javascripts.query.nothing_found"))
            .appendTo($ul);
        }
      })
      .catch(function (error) {
        if (error.name === "AbortError") return;

        $section.find(".loader").hide();

        $("<li>")
          .addClass("list-group-item")
          .text(OSM.i18n.t("javascripts.query.error", { server: url, error: error.message }))
          .appendTo($ul);
      });
  }

  function compareSize(feature1, feature2) {
    const width1 = feature1.bounds.maxlon - feature1.bounds.minlon,
          height1 = feature1.bounds.maxlat - feature1.bounds.minlat,
          area1 = width1 * height1,
          width2 = feature2.bounds.maxlat - feature2.bounds.minlat,
          height2 = feature2.bounds.maxlat - feature2.bounds.minlat,
          area2 = width2 * height2;

    return area1 - area2;
  }

  /*
   * To find nearby objects we ask overpass for the union of the
   * following sets:
   *
   *   node(around:<radius>,<lat>,<lng>)
   *   way(around:<radius>,<lat>,<lng>)
   *   relation(around:<radius>,<lat>,<lng>)
   *
   * to find enclosing objects we first find all the enclosing areas:
   *
   *   is_in(<lat>,<lng>)->.a
   *
   * and then return the union of the following sets:
   *
   *   relation(pivot.a)
   *   way(pivot.a)
   *
   * In both cases we then ask to retrieve tags and the geometry
   * for each object.
   */
  function queryOverpass(lat, lng) {
    const latlng = L.latLng(lat, lng).wrap(),
          bounds = map.getBounds().wrap(),
          zoom = map.getZoom(),
          bbox = [bounds.getSouthWest(), bounds.getNorthEast()]
            .map(c => OSM.cropLocation(c, zoom))
            .join(),
          geombbox = "geom(" + bbox + ");",
          radius = 10 * Math.pow(1.5, 19 - zoom),
          around = "(around:" + radius + "," + lat + "," + lng + ")",
          nodes = "node" + around,
          ways = "way" + around,
          relations = "relation" + around,
          nearby = "(" + nodes + ";" + ways + ";);out tags " + geombbox + relations + ";out " + geombbox,
          isin = "is_in(" + lat + "," + lng + ")->.a;way(pivot.a);out tags bb;out ids " + geombbox + "relation(pivot.a);out tags bb;";

    $("#sidebar_content .query-intro")
      .hide();

    if (marker) map.removeLayer(marker);
    marker = L.circle(latlng, {
      radius: radius,
      className: "query-marker",
      ...featureStyle
    }).addTo(map);

    runQuery(latlng, radius, nearby, $("#query-nearby"), false);
    runQuery(latlng, radius, isin, $("#query-isin"), true, compareSize);
  }

  function clickHandler(e) {
    const [lat, lon] = OSM.cropLocation(e.latlng, map.getZoom());

    OSM.router.route("/query?" + new URLSearchParams({ lat, lon }));
  }

  function enableQueryMode() {
    queryButton.addClass("active");
    map.on("click", clickHandler);
    $(map.getContainer()).addClass("query-active");
  }

  function disableQueryMode() {
    if (marker) map.removeLayer(marker);
    $(map.getContainer()).removeClass("query-active").removeClass("query-disabled");
    map.off("click", clickHandler);
    queryButton.removeClass("active");
  }

  const page = {};

  page.pushstate = page.popstate = function (path) {
    OSM.loadSidebarContent(path, function () {
      page.load(path, true);
    });
  };

  page.load = function (path, noCentre) {
    const params = new URLSearchParams(path.substring(path.indexOf("?"))),
          latlng = L.latLng(params.get("lat"), params.get("lon"));

    if (!location.hash && !noCentre && !map.getBounds().contains(latlng)) {
      OSM.router.withoutMoveListener(function () {
        map.setView(latlng, 15);
      });
    }

    queryOverpass(params.get("lat"), params.get("lon"));
  };

  page.unload = function (sameController) {
    if (!sameController) {
      disableQueryMode();
      $("#sidebar_content .query-results a.selected").each(hideResultGeometry);
    }
  };

  return page;
};
OSM.Home = function (map) {
  let marker;

  function clearMarker() {
    if (marker) map.removeLayer(marker);
    marker = null;
  }

  const page = {};

  page.pushstate = page.popstate = page.load = function () {
    map.setSidebarOverlaid(true);
    clearMarker();

    if (OSM.home) {
      OSM.router.withoutMoveListener(function () {
        map.setView(OSM.home, 15, { reset: true });
      });
      marker = L.marker(OSM.home, {
        icon: OSM.getUserIcon(),
        title: OSM.i18n.t("javascripts.home.marker_title")
      }).addTo(map);
    } else {
      $("#browse_status").html(
        $("<div class='m-2 alert alert-warning'>").text(
          OSM.i18n.t("javascripts.home.not_set")
        )
      );
    }
  };

  page.unload = function () {
    clearMarker();
    $("#browse_status").empty();
  };

  return page;
};
/*
  OSM.Router implements pushState-based navigation for the main page and
  other pages that use a sidebar+map based layout (export, search results,
  history, and browse pages).

  For browsers without pushState, it falls back to full page loads, which all
  of the above pages support.

  The router is initialized with a set of routes: a mapping of URL path templates
  to route controller objects. Path templates can contain placeholders
  (`/note/:id`) and optional segments (`/:type/:id(/history)`).

  Route controller objects can define four methods that are called at defined
  times during routing:

     * The `load` method is called by the router when a path which matches the
       route's path template is loaded via a normal full page load. It is passed
       as arguments the URL path plus any matching arguments for placeholders
       in the path template.

     * The `pushstate` method is called when a page which matches the route's path
       template is loaded via pushState. It is passed the same arguments as `load`.

     * The `popstate` method is called when returning to a previously
       pushState-loaded page via popstate (i.e. browser back/forward buttons).

     * The `unload` method is called on the exiting route controller when navigating
       via pushState or popstate to another route.

   Note that while `load` is not called by the router for pushState-based loads,
   it's frequently useful for route controllers to call it manually inside their
   definition of the `pushstate` and `popstate` methods.

   An instance of OSM.Router is assigned to `OSM.router`. To navigate to a new page
   via pushState (with automatic full-page load fallback), call `OSM.router.route`:

       OSM.router.route('/way/1234');

   If `route` is passed a path that matches one of the path templates, it performs
   the appropriate actions and returns true. Otherwise it returns false.

   OSM.Router also handles updating the hash portion of the URL containing transient
   map state such as the position and zoom level. Some route controllers may wish to
   temporarily suppress updating the hash (for example, to omit the hash on pages
   such as `/way/1234` unless the map is moved). This can be done by using
   `OSM.router.withoutMoveListener` to run a block of code that may update
   move the map without the hash changing.
 */
OSM.Router = function (map, rts) {
  const escapeRegExp = /[-{}[\]+?.,\\^$|#\s]/g;
  const optionalParam = /\((.*?)\)/g;
  const namedParam = /(\(\?)?:\w+/g;
  const splatParam = /\*\w+/g;

  function Route(path, controller) {
    const regexp = new RegExp("^" +
      path.replace(escapeRegExp, "\\$&")
        .replace(optionalParam, "(?:$1)?")
        .replace(namedParam, function (match, optional) {
          return optional ? match : "([^/]+)";
        })
        .replace(splatParam, "(.*?)") + "(?:\\?.*)?$");

    const route = {};

    route.match = function (path) {
      return regexp.test(path);
    };

    route.run = function (action, path) {
      let params = [];

      if (path) {
        params = regexp.exec(path).map(function (param, i) {
          return (i > 0 && param) ? decodeURIComponent(param) : param;
        });
      }

      params = params.concat(Array.prototype.slice.call(arguments, 2));

      return (controller[action] || $.noop).apply(controller, params);
    };

    return route;
  }

  const routes = Object.entries(rts)
    .map(([r, t]) => new Route(r, t));

  routes.recognize = function (path) {
    for (const route of this) {
      if (route.match(path)) return route;
    }
  };

  let currentPath = location.pathname.replace(/(.)\/$/, "$1") + location.search,
      currentRoute = routes.recognize(currentPath),
      currentHash = location.hash || OSM.formatHash(map);

  const router = {};

  function updateSecondaryNav() {
    $("header nav.secondary > ul > li > a").each(function () {
      const active = $(this).attr("href") === location.pathname;

      $(this)
        .toggleClass("text-secondary", !active)
        .toggleClass("text-secondary-emphasis", active);
    });
  }

  $(window).on("popstate", function (e) {
    if (!e.originalEvent.state) return; // Is it a real popstate event or just a hash change?
    const path = location.pathname + location.search,
          route = routes.recognize(path);
    if (path === currentPath) return;
    currentRoute.run("unload", null, route === currentRoute);
    currentPath = path;
    currentRoute = route;
    currentRoute.run("popstate", currentPath);
    updateSecondaryNav();
    map.setState(e.originalEvent.state, { animate: false });
  });

  router.route = function (url) {
    const path = url.replace(/#.*/, ""),
          route = routes.recognize(path);
    if (!route) return false;
    currentRoute.run("unload", null, route === currentRoute);
    const state = OSM.parseHash(url);
    map.setState(state);
    window.history.pushState(state, document.title, url);
    currentPath = path;
    currentRoute = route;
    currentRoute.run("pushstate", currentPath);
    updateSecondaryNav();
    return true;
  };

  router.replace = function (url) {
    window.history.replaceState(OSM.parseHash(url), document.title, url);
  };

  router.stateChange = function (state) {
    const url = state.center ? OSM.formatHash(state) : location;
    window.history.replaceState(state, document.title, url);
  };

  router.updateHash = function () {
    const hash = OSM.formatHash(map);
    if (hash === currentHash) return;
    currentHash = hash;
    router.stateChange(OSM.parseHash(hash));
  };

  router.hashUpdated = function () {
    const hash = location.hash;
    if (hash === currentHash) return;
    currentHash = hash;
    const state = OSM.parseHash(hash);
    map.setState(state);
    router.stateChange(state, hash);
  };

  router.withoutMoveListener = function (callback) {
    function disableMoveListener() {
      map.off("moveend", router.updateHash);
      map.once("moveend", function () {
        map.on("moveend", router.updateHash);
      });
    }

    map.once("movestart", disableMoveListener);
    callback();
    map.off("movestart", disableMoveListener);
  };

  router.load = function () {
    const loadState = currentRoute.run("load", currentPath);
    router.stateChange(loadState || {});
  };

  router.setCurrentPath = function (path) {
    currentPath = path;
    currentRoute = routes.recognize(currentPath);
  };

  map.on("moveend baselayerchange overlayadd overlayremove", router.updateHash);
  $(window).on("hashchange", router.hashUpdated);

  return router;
};
