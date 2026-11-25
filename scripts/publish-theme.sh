#!/usr/bin/env bash
set -euo pipefail
pages=$1
install=$2
GIT_DIR_PATH=$(git rev-parse --absolute-git-dir)
source_commit=$(git rev-parse HEAD)
message=$(git log -1 --format=%B "$source_commit")
# Ignore an older queued run rather than publishing a previous version over main.
git fetch --quiet origin refs/heads/main
[[ $(git rev-parse FETCH_HEAD) == "$source_commit" ]] || exit 0
refs=()
for branch in dist build; do
  directory=$pages
  [[ $branch != build ]] || directory=$install
  [[ -f $directory/index.html && -d $directory/assets ]]
  index=$(mktemp -d)
  tree=$(cd "$directory"; GIT_INDEX_FILE="$index/index" git --git-dir="$GIT_DIR_PATH" --work-tree="$directory" add -- index.html assets; GIT_INDEX_FILE="$index/index" git --git-dir="$GIT_DIR_PATH" write-tree)
  rm -r "$index"
  parent=$(git ls-remote --heads origin "refs/heads/$branch" | cut -f1)
  parents=()
  if [[ -n $parent ]]; then
    git fetch --quiet origin "refs/heads/$branch"
    if [[ $(git rev-parse "$parent^{tree}") == "$tree" && $(git log -1 --format='%(trailers:key=Source,valueonly)' "$parent") == "$source_commit" ]]; then continue; fi
    parents=(-p "$parent")
  elif [[ $branch == dist ]] && git show-ref --verify --quiet refs/remotes/origin/build; then
    # Start the canonical Pages branch with the existing published history.
    parents=(-p "$(git rev-parse refs/remotes/origin/build)")
  fi
  commit=$(printf '%s\n\nSource: %s\n' "$message" "$source_commit" | git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit-tree "$tree" ${parents[@]+"${parents[@]}"})
  refs+=("$commit:refs/heads/$branch")
done
if ((${#refs[@]})); then git push --atomic origin "${refs[@]}"; fi
