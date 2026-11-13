# Pixel Sketch Studio

A photo editing web app that turns photos into drawings, with a before/after view and analytics.
Pink + blue + silver glass UI. No installs, no internet needed.

## Run
Double-click `index.html` (any modern browser: Chrome, Edge, Firefox, Safari).

## Features
- Upload by click or drag & drop 
- 4 effects: Sketch Drawing, Pencil Drawing, Blood Drawing, Cartoon Pencil
- Sliders: Intensity, Detail, Paper grain (live preview)
- Before / After drag slider, plus Before-only and After-only tabs
- Analytics: brightness, contrast, saturation, edge density, unique colours (before, after, change),
  brightness histogram overlay, render time, edit history
- A4 page frame (210 x 297 mm, 1000 x 1414 px): Portrait / Landscape, Fit whole photo or Fill page
- Download the result as PNG or as a ready-to-print A4 PDF, Reset to defaults

## Files
- `index.html` – layout
- `style.css` – pink / blue / silver theme
- `pdf.js` – tiny A4 PDF writer
- `effects.js` – all image effects + analytics (pure JS, no libraries)
- `app.js` – upload, UI, comparison slider, history
