




OSM = {
  ...{"MAX_REQUEST_AREA":0.25,"SERVER_PROTOCOL":"http","SERVER_URL":"openstreetmap.example.com","API_VERSION":"0.6","STATUS":"online","MAX_NOTE_REQUEST_AREA":25,"OVERPASS_URL":"https://overpass-api.de/api/interpreter","OVERPASS_CREDENTIALS":false,"NOMINATIM_URL":"https://nominatim.openstreetmap.org/","GRAPHHOPPER_URL":"https://graphhopper.com/api/1/route","FOSSGIS_OSRM_URL":"https://routing.openstreetmap.de/","FOSSGIS_VALHALLA_URL":"https://valhalla1.openstreetmap.de/route"},

  DEFAULT_LOCALE: "en",

  LAYER_DEFINITIONS: [{"leafletOsmId":"Mapnik","code":"M","layerId":"mapnik","nameId":"standard","canEmbed":true,"canDownloadImage":true,"credit":{"id":"make_a_donation","href":"https://supporting.openstreetmap.org","donate":true}},{"leafletOsmId":"CyclOSM","code":"Y","layerId":"cyclosm","nameId":"cyclosm","canEmbed":true,"credit":{"id":"cyclosm_credit","children":{"cyclosm_link":{"id":"cyclosm_name","href":"https://www.cyclosm.org"},"osm_france_link":{"id":"osm_france","href":"https://openstreetmap.fr/"}}}},{"leafletOsmId":"HOT","code":"H","layerId":"hot","nameId":"hot","canEmbed":true,"credit":{"id":"hotosm_credit","children":{"hotosm_link":{"id":"hotosm_name","href":"https://www.hotosm.org/"},"osm_france_link":{"id":"osm_france","href":"https://openstreetmap.fr/"}}}}],
  LAYERS_WITH_MAP_KEY: ["mapnik","cyclemap"],

  MARKER_GREEN: "/assets/marker-green-a018589d7f15e3d24bdc172041b6edafa5fbb17aa951d4fec717fcb62361b7e1.png",
  MARKER_RED: "/assets/marker-red-839c3d7015788811f3e0d154b69599f099cf8235c036893c61f802ba1a6ccdac.png",

  MARKER_ICON: "/assets/leaflet/dist/images/marker-icon-3d253116ec4ba0e1f22a01cdf1ff7f120fa4d89a6cd0933d68f12951d19809b4.png",
  MARKER_ICON_2X: "/assets/leaflet/dist/images/marker-icon-2x-091245b393c16cdcefe54920aa7d3994a0683317ca9a58d35cbc5ec65996398c.png",
  MARKER_SHADOW: "/assets/leaflet/dist/images/marker-shadow-a2d94406ba198f61f68a71ed8f9f9c701122c0c33b775d990edceae4aece567f.png",

  NEW_NOTE_MARKER: "/assets/new_note_marker-bc5fa092f010b3078b4f297d1b1182fe948c431786504105df53e4d62a901a72.svg",
  OPEN_NOTE_MARKER: "/assets/open_note_marker-70fa2b646383c80c62d52a6ef4bc68e4b3aa7fb915c27aed68a3f61b495509f0.svg",
  CLOSED_NOTE_MARKER: "/assets/closed_note_marker-991a5e08b56b633bb27db7a5d44b5d745b0e6202727cb99db32d851c34ca6dd2.svg",

  apiUrl: function (object) {
    const apiType = object.type === "note" ? "notes" : object.type;
    let url = "/api/" + OSM.API_VERSION + "/" + apiType + "/" + object.id;

    if (object.type === "way" || object.type === "relation") {
      url += "/full";
    } else if (object.version) {
      url += "/" + object.version;
    }

    return url;
  },

  mapParams: function (search) {
    const params = new URLSearchParams(search || location.search),
          mapParams = {};

    if (params.has("mlon") && params.has("mlat")) {
      mapParams.marker = true;
      mapParams.mlon = parseFloat(params.get("mlon"));
      mapParams.mlat = parseFloat(params.get("mlat"));
    }

    // Old-style object parameters; still in use for edit links e.g. /edit?way=1234
    for (const type of ["node", "way", "relation", "note"]) {
      if (params.has(type)) {
        mapParams.object = { type, id: parseInt(params.get(type), 10) };
      }
    }

    const hash = OSM.parseHash();

    const loc = Cookies.get("_osm_location")?.split("|");

    function bboxToLatLngBounds({ minlon, minlat, maxlon, maxlat }) {
      return L.latLngBounds([minlat, minlon], [maxlat, maxlon]);
    }

    // Decide on a map starting position. Various ways of doing this.
    if (hash.center) {
      mapParams.lon = hash.center.lng;
      mapParams.lat = hash.center.lat;
      mapParams.zoom = hash.zoom;
    } else if (params.has("bbox")) {
      const [minlon, minlat, maxlon, maxlat] = params.get("bbox").split(",");
      mapParams.bounds = bboxToLatLngBounds({ minlon, minlat, maxlon, maxlat });
    } else if (params.has("minlon") && params.has("minlat") && params.has("maxlon") && params.has("maxlat")) {
      mapParams.bounds = bboxToLatLngBounds(Object.fromEntries(params));
    } else if (params.has("mlon") && params.has("mlat")) {
      mapParams.lon = params.get("mlon");
      mapParams.lat = params.get("mlat");
      mapParams.zoom = params.get("zoom") || 12;
    } else if (loc) {
      [mapParams.lon, mapParams.lat, mapParams.zoom] = loc;
    } else if (OSM.home) {
      mapParams.lon = OSM.home.lon;
      mapParams.lat = OSM.home.lat;
      mapParams.zoom = 10;
    } else if (OSM.location) {
      mapParams.bounds = bboxToLatLngBounds(OSM.location);
    } else {
      mapParams.lon = -0.1;
      mapParams.lat = 51.5;
      mapParams.zoom = params.get("zoom") || 5;
    }

    if (typeof mapParams.lat === "string") mapParams.lat = parseFloat(mapParams.lat);
    if (typeof mapParams.lon === "string") mapParams.lon = parseFloat(mapParams.lon);
    if (typeof mapParams.zoom === "string") mapParams.zoom = parseInt(mapParams.zoom, 10);

    mapParams.layers = hash.layers || (loc && loc[3]) || "";

    const scale = parseFloat(params.get("scale"));
    if (scale > 0) {
      mapParams.zoom = Math.log(360.0 / (scale * 512.0)) / Math.log(2.0);
    }

    return mapParams;
  },

  parseHash: function (hash = location.hash) {
    const args = {};

    const i = hash.indexOf("#");
    if (i < 0) {
      return args;
    }

    const hashParams = new URLSearchParams(hash.slice(i + 1));

    const map = (hashParams.get("map") || "").split("/"),
          zoom = parseInt(map[0], 10),
          lat = parseFloat(map[1]),
          lon = parseFloat(map[2]);

    if (!isNaN(zoom) && !isNaN(lat) && !isNaN(lon)) {
      args.center = new L.LatLng(lat, lon);
      args.zoom = zoom;
    }

    if (hashParams.has("layers")) {
      args.layers = hashParams.get("layers");
    }

    return args;
  },

  formatHash: function (args) {
    let center, zoom, layers;

    if (args instanceof L.Map) {
      center = args.getCenter();
      zoom = args.getZoom();
      layers = args.getLayersCode();
    } else if (args instanceof URLSearchParams) {
      center = args.get("center") || L.latLng(args.get("lat"), args.get("lon"));
      zoom = args.get("zoom");
      layers = args.get("layers") || "";
    } else {
      center = args.center || L.latLng(args.lat, args.lon);
      zoom = args.zoom;
      layers = args.layers || "";
    }

    layers = layers.replace("M", "");

    let hash = "#map=" + [zoom, ...OSM.cropLocation(center, zoom)].join("/");

    if (layers) {
      hash += "&layers=" + layers;
    }

    return hash;
  },

  zoomPrecision: function (zoom) {
    const pixels = Math.pow(2, 8 + zoom);
    const degrees = 180;
    return Math.ceil(Math.log10(pixels / degrees));
  },

  cropLocation: function (latLng, zoom) {
    const precision = OSM.zoomPrecision(zoom),
          wrapped = latLng.wrap();
    return [wrapped.lat, wrapped.lng].map(c => c.toFixed(precision));
  },

  locationCookie: function (map) {
    const zoom = map.getZoom(),
          center = OSM.cropLocation(map.getCenter(), zoom).reverse();
    return [...center, zoom, map.getLayersCode()].join("|");
  },

  distance: function (latlng1, latlng2) {
    const lat1 = latlng1.lat * Math.PI / 180,
          lng1 = latlng1.lng * Math.PI / 180,
          lat2 = latlng2.lat * Math.PI / 180,
          lng2 = latlng2.lng * Math.PI / 180,
          latdiff = lat2 - lat1,
          lngdiff = lng2 - lng1;

    return 6372795 * 2 * Math.asin(
      Math.sqrt(
        Math.pow(Math.sin(latdiff / 2), 2) +
        (Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(lngdiff / 2), 2))
      ));
  }
};
