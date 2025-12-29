#!/bin/sh

## hyphop ##
#= simple shell script to play AAAM music from console

help(){
cat <<EOF
    curl https://another-art-another-music.pages.dev/sh/listen.sh | sh -s
    curl https://another-art-another-music.pages.dev/sh/listen.sh | sh -s --shuffle
EOF
}

help

GITHUB_USER="Another-Art-Another-Music"
GITHUB_REPO="listen"
: ${PAGE:=1}
: ${PER_PAGE:=100}
API_URL="https://api.github.com/repos/$GITHUB_USER/$GITHUB_REPO/releases?per_page=$PER_PAGE"
TMP_JSON="/tmp/github_releases.json"
PLAYLIST_FILE="/tmp/$GITHUB_USER.m3u"

fetch_and_create_playlist() {
    echo "AAAM: https://another-art-another-music.pages.dev/"
    echo "Fetching releases: $GITHUB_USER/$GITHUB_REPO"
    echo "$API_URL"
    curl -f -s "$API_URL" -o "$TMP_JSON" || {
	echo "[e] OOOPS"
	head -n2 "$TMP_JSON"
	exit 1
    }

    # Count total releases
    TOTAL_RELEASES=$(jq 'length' "$TMP_JSON")
    echo "Total Releases Found: $TOTAL_RELEASES"
    TRACKS=$(jq -r '[.[].assets[] | select(.name | endswith(".opus")) | .browser_download_url] | .[]' "$TMP_JSON")
    TOTAL_TRACKS=$(echo "$TRACKS" | wc -l)

    [ "$TOTAL_TRACKS" = "0" ] && {
        echo "[W] No audio tracks found in any release."
        exit 1
    }

    echo "[v] Total Tracks Found: $TOTAL_TRACKS"

    # Save tracks to MPV playlist file
    echo "$TRACKS" > "$PLAYLIST_FILE"
    echo "[x] Playlist saved to: $PLAYLIST_FILE"

    echo "@ Playlist Contents:"
    while read l; do
	echo ${l##*/}
    done < $PLAYLIST_FILE

}

CMD(){
    echo "# $@">&2
    "$@"
}

play_with() {
    echo "MPV backend"
    CMD mpv --playlist="$PLAYLIST_FILE" --loop-playlist=inf "$@"
}

fetch_and_create_playlist
play_with "$@"
