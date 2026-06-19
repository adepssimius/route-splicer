# route/splicer

Static GitHub Pages app for building one continuous GPX route from repeated GPX loops and partial laps.

## Features

- Runs entirely in the browser.
- Reads GPX routes/tracks, GeoJSON line features, and KML line strings.
- Repeats each file by lap count.
- Duplicates waypoints for every lap by default.
- Validates inter-lap and file-to-file join gaps.
- Draws source files, combined output, and warnings on a Leaflet/OpenStreetMap map.
- Downloads a single combined GPX route.

## Local Preview

From this folder:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## GitHub Pages

1. In GitHub, go to `Settings` -> `Pages`.
2. Set source to `Deploy from a branch`.
3. Choose `main` and `/root`.
4. Save.

The app is static, so no build command is needed.
