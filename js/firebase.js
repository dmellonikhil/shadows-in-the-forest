// js/firebase.js
// Initialises Firebase once and exports the db reference.
// Import this in every page that needs Firebase.

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const FIREBASE_CONFIG = {
  apiKey:      "AIzaSyCSkdcF6XmW6-ROU_LhQLTfdta1HUbru4c",
  authDomain:  "shadows-in-the-forest.firebaseapp.com",
  databaseURL: "https://shadows-in-the-forest-default-rtdb.firebaseio.com",
  projectId:   "shadows-in-the-forest",
  appId:       "1:277386752922:web:881b4d7a5b14a151f18023",
};

let _db;

export function getDB() {
  if (!_db) {
    // reuse existing app if already initialised (avoids duplicate-app error)
    const app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
    _db = getDatabase(app);
  }
  return _db;
}

// ── Session helpers ────────────────────────────────────────
// All pages read/write game identity through these helpers.

export function saveSession(code, myId, myRole, myName, myColor) {
  sessionStorage.setItem('sitf_code',    code);
  sessionStorage.setItem('sitf_myId',    myId);
  sessionStorage.setItem('sitf_myRole',  myRole);
  sessionStorage.setItem('sitf_myName',  myName);
  sessionStorage.setItem('sitf_myColor', myColor);
}

export function loadSession() {
  return {
    code:    sessionStorage.getItem('sitf_code')    || '',
    myId:    sessionStorage.getItem('sitf_myId')    || '',
    myRole:  sessionStorage.getItem('sitf_myRole')  || '',
    myName:  sessionStorage.getItem('sitf_myName')  || '',
    myColor: sessionStorage.getItem('sitf_myColor') || '#c0d8b0',
  };
}

export function clearSession() {
  ['sitf_code','sitf_myId','sitf_myRole','sitf_myName','sitf_myColor']
    .forEach(k => sessionStorage.removeItem(k));
}
