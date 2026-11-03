#!/bin/sh
# Met un numéro de version (cache des navigateurs + mise à jour automatique), à lancer avant chaque commit.
V=$(date +%Y%m%d%H%M)
sed -i -E "s/(\?v=)[0-9A-Z_]+/\1$V/g" index.html
sed -i -E "s/var VERSION = '[^']*'/var VERSION = '$V'/" app.js
echo "$V" > version.txt
echo "Version $V"
