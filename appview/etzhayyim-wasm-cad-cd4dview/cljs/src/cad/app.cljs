(ns cad.app
  "etzhayyim-wasm-cad-cd4dview appview — reagent + re-frame, view built from
  jp-go-dds (デジタル庁デザインシステム) hiccup.

  This is a faithful port of the previous Svelte 5 scaffold (`App.svelte`):
  one heading and one status paragraph, nothing more. It does not add CAD
  viewer functionality that was not already there — the real, working CAD
  viewer surface for this repo remains the prebuilt wasm bundle served from
  `appview/etzhayyim-wasm-cad-cd4dview/static/v2.htm` (source: upstream
  `kotoba-lang/kami-app-cad`), which this migration does not touch. See
  docs/adr/0001-what-this-repo-is-authoritative-for.md."
  (:require [reagent.dom :as rdom]
            [re-frame.core :as rf]
            [jp-go-dds.core :as dds]))

;; -- db ------------------------------------------------------------------
;;
;; The Svelte scaffold had no state at all (`App.svelte` was static markup).
;; The heading/message pair is kept as re-frame db + sub so the migration
;; actually exercises the event/sub plumbing the workspace standard calls
;; for, without inventing app behaviour beyond the original two lines of text.

(def default-db
  {:heading "etzhayyim-wasm-cad-cd4dview"
   :message "ClojureScript entry scaffold after Svelte migration."})

(rf/reg-event-db
 :initialize-db
 (fn [_ _] default-db))

(rf/reg-sub :heading (fn [db _] (:heading db)))
(rf/reg-sub :message (fn [db _] (:message db)))

;; -- view ------------------------------------------------------------------

(defn app-view []
  (let [heading @(rf/subscribe [:heading])
        message @(rf/subscribe [:message])]
    (dds/container
     (dds/section {}
       (dds/heading 1 heading)
       [:p {:class "dds-ext-lead"} message]))))

;; -- init --------------------------------------------------------------------

(defn ^:export main []
  (rf/dispatch-sync [:initialize-db])
  (rdom/render [app-view] (js/document.getElementById "app")))
