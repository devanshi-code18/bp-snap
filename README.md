# BP Snap

Take a photo of a blood pressure monitor. BP Snap reads the numbers, you check them, and it keeps a log with the date and time, per person, on your phone.

**Open it:** https://devanshi-code18.github.io/bp-snap/

- 📷 **Photo in, numbers out.** Reads the seven-segment screen (SYS, DIA, pulse) right in the browser. Nothing is uploaded.
- ✍️ **You stay in charge.** Every reading is shown for you to confirm or fix before it's saved. Drag a box around the numbers if the first read misses.
- 🕒 **Timing.** Uses the photo's capture time, tags morning / afternoon / evening / night, and shows morning vs evening averages.
- 👪 **Several people on one phone.** Switch person from the top right.
- 📈 **Trends and a doctor-ready report.** 7 / 30 / 90-day averages, a chart, ACC/AHA categories, print to PDF, CSV export or share.
- 📅 **Reminders.** Adds daily morning and evening reminders to your calendar.
- 📴 **Works offline** once opened, and installs to the Home Screen like an app.

## Use it on an iPhone

1. Open https://devanshi-code18.github.io/bp-snap/ in Safari.
2. Tap Share, then **Add to Home Screen**. (Safari can clear site data after a week of not visiting; Home Screen apps keep it.)
3. Enter whose readings these are, measure, and tap **Take photo of monitor** when the final numbers show.
4. Check the numbers against the monitor and tap **Save reading**.

Photo tips: hold the phone straight over the screen, fill the frame with the display, and tilt a little if there is glare.

## Your data

Readings and photos are stored in the browser on your phone (IndexedDB). There is no server and no account. Use **Settings → Save backup** now and then and keep the file in Files / iCloud Drive; **Restore backup** brings it back on any phone.

## Not a medical device

BP Snap is a log. Always check numbers against the monitor and discuss readings with a doctor. Categories follow the ACC/AHA guideline (normal < 120/80, elevated 120–129/<80, stage 1 130–139 or 80–89, stage 2 ≥ 140 or ≥ 90; above 180/120: measure again and contact a doctor).

## Development

Plain HTML, CSS and ES modules, no build step and no dependencies.

```sh
npm test               # unit tests: reader, stats, EXIF
npm run eval           # reader accuracy on 60 synthetic monitor photos
python3 -m http.server 8080   # then open http://localhost:8080
```

Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/pages.yml`).

How the reader works (`js/ocr/sevenseg.js`): local thresholding (dark-on-light and light-on-dark), blob detection at several merge radii to find digit-shaped marks, then per row: remove the italic slant, cut digits at empty columns, and decode each digit from its seven segment zones. SYS, DIA and pulse are picked by value range, size and layout (SYS above DIA, pulse smallest).

## License

MIT
