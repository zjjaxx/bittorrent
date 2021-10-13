module.exports = {
  apps : [{
    name   : "pm2_app",
    log_date_format:"YYYY-MM-DD HH:mm ",
    script : "./index.js",
    error_file:"errorFile",
    out_file:"outFile"
  }]
}
