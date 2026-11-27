"use strict";

const {backup, DatabaseSync} = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");

async function backupDatabase(source, destination) {
  if (!source || !destination || path.resolve(source) === path.resolve(destination)) {
    throw Error("Provide different source and destination files");
  }
  const temporary = destination + "." + randomUUID() + ".tmp";
  const db = new DatabaseSync(source, {readOnly: true});
  try {
    await backup(db, temporary);
    const copy = new DatabaseSync(temporary, {readOnly: true});
    try {
      const result = copy.prepare("PRAGMA integrity_check").get();
      if (result.integrity_check !== "ok" ||
          !copy.prepare("SELECT 1 FROM sqlite_schema WHERE name='trips' AND type='table'").get()) {
        throw Error("Database verification failed");
      }
    } finally {
      copy.close();
    }
    fs.copyFileSync(temporary, destination, fs.constants.COPYFILE_EXCL);
  } finally {
    db.close();
    fs.rmSync(temporary, {force: true});
  }
}

if (require.main === module) {
  backupDatabase(process.argv[2], process.argv[3]).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {backupDatabase};
