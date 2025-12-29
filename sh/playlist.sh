#!/bin/sh

##
## hyphop ##
##

: ${PER_PAGES:=50}
: ${REPO:=Another-Art-Another-Music/listen}
: ${API:=https://api.github.com/repos/$REPO/releases?per_page=$PER_PAGES}

: ${TMP:=/tmp/aaam.rel}

LAST=0

[ -s "$TMP" ] && LAST=$(stat -c%Z "$TMP")

NOW=$(date +%s)
RATE=60

echo "$LAST $NOW $((NOW-LAST))" >&2

[ "$LAST" ] && [ "$((NOW-LAST))" -gt $RATE ] && {
	curl --http1.1 -vsf "$API" -o "$TMP" || exit
}

: ${M3U:=/tmp/aaam.m3u}

echo "#EXTM3U" >$M3U

sed 's/[{}]/\n&\n/g' "$TMP" | \
while read -r line; do
    case "$line" in
        *'"browser_download_url"'*'.opus"'*)
	    url=${line#*//}
	    rel=${url%/*}
	    rel=${rel##*/}
	    url=${url%\"*}
            echo "#EXTINF:-1,$rel" >>$M3U
            echo "https://$url" >> $M3U
            ;;
    esac
done

cat $M3U
#mpv $M3U

