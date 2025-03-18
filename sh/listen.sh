#!/bin/sh

## hyphop ##
#= simple shell script to play AAAM music from console

GITHUB_USER="Another-Art-Another-Music"
GITHUB_REPO="listen"
API_URL="https://api.github.com/repos/$GITHUB_USER/$GITHUB_REPO/releases"
TMP_JSON="/tmp/github_releases.json"
PLAYLIST_FILE="/tmp/$GITHUB_USER.m3u"

fetch_and_create_playlist() {
    echo "AAAM: https://another-art-another-music.pages.dev/"
    echo "Fetching releases: $GITHUB_USER/$GITHUB_REPO"
    curl -s "$API_URL" -o "$TMP_JSON"

    # Count total releases
    TOTAL_RELEASES=$(jq 'length' "$TMP_JSON")
    echo "📀 Total Releases Found: $TOTAL_RELEASES"
    TRACKS=$(jq -r '[.[].assets[] | select(.name | endswith(".opus")) | .browser_download_url] | .[]' "$TMP_JSON")
    TOTAL_TRACKS=$(echo "$TRACKS" | wc -l)

    [ "$TOTAL_TRACKS" = "0" ] && {
        echo "❌ No audio tracks found in any release."
        exit 1
    }

    echo "🎵 Total Tracks Found: $TOTAL_TRACKS"

    # Save tracks to MPV playlist file
    echo "$TRACKS" > "$PLAYLIST_FILE"
    echo "✅ Playlist saved to: $PLAYLIST_FILE"

    echo "🎶 Playlist Contents:"
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
    mpv --playlist="$PLAYLIST_FILE" --loop-playlist=inf --shuffle # --no-video
}

fetch_and_create_playlist
play_with
