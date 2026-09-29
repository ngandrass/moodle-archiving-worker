/*
 * Moodle Archiving Worker
 * Copyright (C) 2026 Niels Gandraß <niels@gandrass.de>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * This script is injected into each page to check if the page is ready for export.
 */

/**
 * Interval in milliseconds the readiness probe checks are executed after the initial delay.
 * @type {number}
 */
const MOODLE_ARCHIVER_READINESS_PROBE_INTERVAL_MS = 250;

/**
 * Number of milliseconds to wait after the last mutation of a GeoGebra applet before
 * considering it stable and ready for export.
 * @type {number}
 */
const MOODLE_ARCHIVER_GEOGEBRA_MUTATION_STABLE_PERIOD_MS = 2000;

const SIGNAL_PAGE_READY_FOR_EXPORT = "x-moodle-archiver-page-ready-for-export";
const SIGNAL_GEOGEBRA_FOUND = "x-moodle-archiver-geogebra-found";
const SIGNAL_GEOGEBRA_NOT_FOUND = "x-moodle-archiver-geogebra-not-found";
const SIGNAL_GEOGEBRA_MUTATED = "x-moodle-archiver-geogebra-mutated";
const SIGNAL_GEOGEBRA_READY_FOR_EXPORT = "x-moodle-archiver-geogebra-ready-for-export";
const SIGNAL_MATHJAX_FOUND = "x-moodle-archiver-mathjax-found";
const SIGNAL_MATHJAX_NOT_FOUND = "x-moodle-archiver-mathjax-not-found";
const SIGNAL_MATHJAX_NO_FORMULAS_ON_PAGE = "x-moodle-archiver-mathjax-no-formulas-on-page";
const SIGNAL_MATHJAX_READY_FOR_EXPORT = "x-moodle-archiver-mathjax-ready-for-export";
const SIGNAL_VPLQUESTION_FOUND = "x-moodle-archiver-vplquestion-found";
const SIGNAL_VPLQUESTION_NOT_FOUND = "x-moodle-archiver-vplquestion-not-found";
const SIGNAL_VPLQUESTION_EDITOR_RESIZED = "x-moodle-archiver-vplquestion-editor-resized";
const SIGNAL_VPLQUESTION_READY_FOR_EXPORT = "x-moodle-archiver-vplquestion-ready-for-export";

/**
 * Global object to store readiness signals for different components.
 *
 * @type {{readySignals: {geogebra: null, mathjax: null, vplquestion: null}}}
 */
window.MoodleArchiver = {
    initialized: false,         // True if the readiness detection process has been initialized
    readySignals: {
        mathjax: null,          // True if MathJax is ready for export, null if MathJax is not found
        geogebra: null,         // True if GeoGebra is ready for export, null if GeoGebra is not found
        vplquestion: null       // True if VPL Question is ready for export, null if VPL Question is not found
    },
    states: {                   // Optional stateful data for different components
        geogebra: {
            last_mutation: null // Timestamp of the last mutation of a GeoGebra applet
        },
        vplquestion: {
            expected_editors: 0 // Number of VPL Question code editors expected on the page
        }
    }
};

/**
 * Detects and prepares readiness signals for all tracked components.
 * This function must be called prior to checkReadiness().
 */
function detectAndPrepareReadinessComponents() {
    // MathJax
    if (typeof window.MathJax !== 'undefined') {
        window.MoodleArchiver.readySignals.mathjax = false;
        console.log(SIGNAL_MATHJAX_FOUND);

        // Check if MathJax is not just loaded but the page also has formulas on it
        if (document.getElementsByClassName('filter_mathjaxloader_equation').length === 0) {
            window.MoodleArchiver.readySignals.mathjax = true;
            console.log(SIGNAL_MATHJAX_NO_FORMULAS_ON_PAGE);
            console.log(SIGNAL_MATHJAX_READY_FOR_EXPORT);
        } else {
            // Formulas found. Wait for MathJax to process them.
            let mjVersion = window.MathJax.version
            if (mjVersion.startsWith('2')) {
                console.debug("MathJax version '" + mjVersion + "' detected. Waiting for MathJax to process equations ...");
                window.MathJax.Hub.Queue(function () {
                    window.MoodleArchiver.readySignals.mathjax = true;
                    console.log(SIGNAL_MATHJAX_READY_FOR_EXPORT);
                });
                window.MathJax.Hub.processSectionDelay = 0;
            } else if (mjVersion.startsWith('3') || mjVersion.startsWith('4')) {
                console.debug("MathJax version '" + mjVersion + "' detected. Waiting for MathJax to process equations ...");
                window.MathJax.startup.promise.then(() => {
                    window.MoodleArchiver.readySignals.mathjax = true;
                    console.log(SIGNAL_MATHJAX_READY_FOR_EXPORT);
                });
            } else {
                console.error("Unknown MathJax version '" + mjVersion + "' detected");
                console.debug("Just waiting 3 seconds ...")
                setTimeout(() => {
                    window.MoodleArchiver.readySignals.mathjax = true;
                    console.log(SIGNAL_MATHJAX_READY_FOR_EXPORT);
                }, 3000 );
            }
        }
    } else {
        console.log(SIGNAL_MATHJAX_NOT_FOUND);
    }

    // GeoGebra
    if (typeof window.GGBApplet !== 'undefined') {
        window.MoodleArchiver.readySignals.geogebra = false;
        window.MoodleArchiver.states.geogebra.last_mutation = new Date(9999, 1, 1);  // Far future
        console.log(SIGNAL_GEOGEBRA_FOUND);

        // Attach mutation observer to GeoGebra frames once available
        attachGeogebraMutationObserver();
    } else {
        console.log(SIGNAL_GEOGEBRA_NOT_FOUND);
    }

    // VPL Question (Asynchronously rendered Ace editors)
    const vplEditorCount = document.querySelectorAll('.que.vplquestion textarea[data-role="code-editor"]').length;
    if (vplEditorCount > 0) {
        window.MoodleArchiver.readySignals.vplquestion = false;
        window.MoodleArchiver.states.vplquestion.expected_editors = vplEditorCount;
        console.log(SIGNAL_VPLQUESTION_FOUND);
        console.debug(`Detected ${vplEditorCount} VPL Question code editor(s)`);

        // Attach observer to wait for Ace editors to be rendered by qtype_vplquestion before doing anything
        attachVplQuestionEditorRenderingObserver();
    } else {
        console.log(SIGNAL_VPLQUESTION_NOT_FOUND);
    }

    window.MoodleArchiver.initialized = true;
}

/**
 * Waits for GeoGebra to be initialized to the point where it rendered its final
 * applet frames and attach mutation observers to them.
 *
 * This also ignites the readiness detection process for GeoGebra.
 */
function attachGeogebraMutationObserver() {
    // Check if GeoGebra is initialized to the point where it created its target applet frames
    try {
        if (typeof window.GGBApplet().getAppletObject === 'function') {
            // Get all GeoGebra frames on the page and ensure that all are fully loaded.
            const ggbFrames = document.getElementsByClassName('GeoGebraFrame');
            if (ggbFrames.length > 0) {
                // Prepare iteration variables
                let frameNumber = 0;
                let allFramesLoaded = true;

                // Ensure that all frames are fully loaded (contain 'jsloaded' class)
                ggbFrames.forEach(ggbFrame => {
                    frameNumber++;

                    if (ggbFrame.classList.contains('jsloaded') !== true) {
                        allFramesLoaded = false;
                        console.log(`GeoGebra frame ${frameNumber} not fully loaded yet. Waiting ...`);
                    }
                });

                if (allFramesLoaded === true) {
                    // Attach mutation listener to GeoGebra frames
                    let mutationObserver = new (window.MutationObserver || window.WebKitMutationObserver)(() => {
                        window.MoodleArchiver.states.geogebra.last_mutation = new Date();
                        console.log(SIGNAL_GEOGEBRA_MUTATED);
                    });

                    document.getElementsByClassName('GeoGebraFrame').forEach(ggbFrame => {
                        mutationObserver.observe(ggbFrame, { childList: true, subtree: true });
                        console.log("Attached mutation observer to GeoGebra frame.");
                    });
                    window.MoodleArchiver.states.geogebra.last_mutation = new Date();

                    // Ignite periodic readiness check
                    setTimeout(detectGeogebraFinishedRendering, MOODLE_ARCHIVER_READINESS_PROBE_INTERVAL_MS);
                    return;
                } else {
                    console.log(`Not all ${frameNumber} GeoGebra frames are fully loaded yet. Waiting ...`);
                }
            } else {
                console.log("GeoGebra frame(s) not fully initialized yet. Waiting ...");
            }
        } else {
            console.log("GeoGebra applet object not yet ready. Waiting ...");
        }
    } catch (e) {
        if (e instanceof TypeError) {
            console.log("GeoGebra applet/frames not yet ready. Waiting ...");
        } else {
            console.log("Failed to attach mutation observer to GeoGebra frames: " + e);
        }
    }

    // If we got here, GeoGebra is not ready yet. Retry in a bit.
    setTimeout(attachGeogebraMutationObserver, MOODLE_ARCHIVER_READINESS_PROBE_INTERVAL_MS);
}

/**
 * Detects when GeoGebra instances have finished rendering. This function calls
 * itself periodically until all applets are rendered.
 *
 * Results are stored inside window.MoodleArchiver.readySignals.geogebra.
 */
function detectGeogebraFinishedRendering() {
    // Declare GeoGebra to be ready for export if no mutation has occurred since the given time
    const lastMutationMs = window.MoodleArchiver.states.geogebra.last_mutation.getTime();
    if (new Date().getTime() >= lastMutationMs + MOODLE_ARCHIVER_GEOGEBRA_MUTATION_STABLE_PERIOD_MS) {
        window.MoodleArchiver.readySignals.geogebra = true;
        console.log(SIGNAL_GEOGEBRA_READY_FOR_EXPORT);
    } else {
        window.MoodleArchiver.readySignals.geogebra = false;
        setTimeout(detectGeogebraFinishedRendering, MOODLE_ARCHIVER_READINESS_PROBE_INTERVAL_MS);
    }
}

/**
 * Waits for all VPL Question Ace editors to be rendered.
 *
 * Once all editors are rendered, soft wrapping is enabled and a resize handler
 * for the upcoming print reflow is attached.
 *
 * Results are stored inside window.MoodleArchiver.readySignals.vplquestion.
 */
function attachVplQuestionEditorRenderingObserver() {
    // Detect rendered Ace editors. We need the placeholder element to get the actual editor element ...
    const actualEditors = Array.from(document.querySelectorAll('.que.vplquestion .ace-placeholder.ace_editor'))
        .map(placeholder => ({placeholder, editor: placeholder.env ? placeholder.env.editor : undefined}))
        .filter(({editor}) => typeof editor !== 'undefined' && editor.renderer.lineHeight > 0);

    // Compare currently rendered editors against the expected number
    const expectedEditors = window.MoodleArchiver.states.vplquestion.expected_editors;
    if (actualEditors.length < expectedEditors) {
        console.log(`Only ${actualEditors.length} of ${expectedEditors} VPL Question editors rendered yet. Waiting ...`);
        setTimeout(attachVplQuestionEditorRenderingObserver, MOODLE_ARCHIVER_READINESS_PROBE_INTERVAL_MS);
        return;
    }

    // All expected editors are actually rendered
    // We must attach the handler for the print layout because it again reflows the page
    actualEditors.forEach(({editor}) => editor.getSession().setUseWrapMode(true));
    window.matchMedia('print').addEventListener('change', (e) => {
        if (e.matches) {
            actualEditors.forEach(({placeholder, editor}) => fitVplQuestionEditorToContent(placeholder, editor));
        }
    });

    window.MoodleArchiver.readySignals.vplquestion = true;
    console.log(SIGNAL_VPLQUESTION_READY_FOR_EXPORT);
}

/**
 * Resizes the container of the given Ace editor to fit its whole content
 * without scrolling, based on the current width of the container.
 *
 * @param {HTMLElement} placeholder The Ace editor container element
 * @param {Object} editor The Ace editor instance
 */
function fitVplQuestionEditorToContent(placeholder, editor) {
    const renderer = editor.renderer;
    editor.resize(true); // Re-wrap lines for the current container width

    const lines = editor.getSession().getScreenLength();
    const hScroll = renderer.$horizScroll ? renderer.scrollBarH.getHeight() : 0;
    const border = placeholder.offsetHeight - placeholder.clientHeight;
    const height = Math.ceil(lines * renderer.lineHeight + renderer.scrollMargin.v + hScroll + border);

    placeholder.style.height = height + 'px';
    editor.resize(true);

    console.log(SIGNAL_VPLQUESTION_EDITOR_RESIZED);
    console.debug(`Resized VPL Question editor #${placeholder.id} to ${height}px (${lines} lines).`);
}

/**
 * Checks if all components are ready for export. If not, this function will
 * call itself periodically until all components are ready.
 */
function checkReadiness() {
    if (!window.MoodleArchiver.initialized) {
        console.error("Failed to check component export readiness before initialization.");
        setTimeout(checkReadiness, MOODLE_ARCHIVER_READINESS_PROBE_INTERVAL_MS);
        return;
    }

    for (const [component, ready] of Object.entries(window.MoodleArchiver.readySignals)) {
        if (ready === null) {
            continue;
        }
        if (ready !== true) {
            setTimeout(checkReadiness, MOODLE_ARCHIVER_READINESS_PROBE_INTERVAL_MS);
            return;
        }
    }

    console.log(SIGNAL_PAGE_READY_FOR_EXPORT);
}

// Ignite the readiness detection process.
setTimeout(function() {
    detectAndPrepareReadinessComponents();
    checkReadiness();
}, 1000);
