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
