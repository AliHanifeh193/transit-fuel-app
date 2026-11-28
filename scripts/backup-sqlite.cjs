"use strict";
// Safe online SQLite snapshot. No changes to source database.
// Usage: node scripts/backup-sqlite.cjs <existing-db-path> <existing-backup-directory>
const fs=require("node:fs");
const path=require("node:path");
const {DatabaseSync,backup}=require("node:sqlite");
(async()=>{
  const [source,directory]=process.argv.slice(2);
  if(!source||!directory) throw Error("usage: node scripts/backup-sqlite.cjs <db> <backup-directory>");
  const dbPath=fs.realpathSync(source);
  if(!fs.statSync(dbPath).isFile()) throw Error("source_is_not_a_file");
  const backupDir=fs.realpathSync(directory);
  if(backupDir===path.dirname(dbPath)) throw Error("backup_directory_must_be_separate");
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const dest=path.join(backupDir,`transit-fuel-${stamp}-${process.pid}.sqlite`);
  if(fs.existsSync(dest)) throw Error("destination_exists");
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
    if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok") throw Error("source_integrity_failure");
    await backup(db,dest);
  } finally {db.close();}
  const check=new DatabaseSync(dest,{readOnly:true});
  try{
    if(check.prepare("PRAGMA integrity_check").get().integrity_check!=="ok") throw Error("backup_integrity_failure");
    const users=check.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    console.log("BACKUP_STATUS: PASS");
    console.log("BACKUP_PATH: "+dest);
    console.log("BACKUP_USER_COUNT: "+users);
    console.log("BACKUP_BYTES: "+fs.statSync(dest).size);
    console.log("BACKUP_CAUTION: File contains sensitive account and financial information; encrypt and restrict access.");
  }finally{check.close();}
})().catch(e=>{console.error("BACKUP_STATUS: FAILED "+e.message);process.exitCode=1;});
