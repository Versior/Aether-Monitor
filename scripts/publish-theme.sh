#!/usr/bin/env bash
set -euo pipefail
pages=$1
install=$2
GIT_DIR_PATH=$(git rev-parse --absolute-git-dir)
source_commit=$(git rev-parse HEAD)
message=$(git log -1 --format=%B "$source_commit")
git fetch --quiet origin refs/heads/main
if ! git merge-base --is-ancestor "$source_commit" FETCH_HEAD; then
  printf 'Source %s is not in the history of origin/main.\n' "$source_commit" >&2
  exit 1
fi
publication_commit() {
  git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit-tree "$@"
}
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
  late_source=false
  if [[ -n $parent ]]; then
    git fetch --quiet origin "refs/heads/$branch"
    live=$(git log -1 --format='%(trailers:key=Live-Source,valueonly)' "$parent")
    if [[ -z $live ]]; then live=$(git log -1 --format='%(trailers:key=Source,valueonly)' "$parent"); fi
    if [[ $live == "$source_commit" && $(git rev-parse "$parent^{tree}") == "$tree" ]]; then continue; fi
    if [[ -n $live && $live != "$source_commit" ]]; then
      if git merge-base --is-ancestor "$source_commit" "$live"; then
        if git log --format='%(trailers:key=Source,valueonly)' "$parent" | grep -Fx "$source_commit" >/dev/null; then continue; fi
        late_source=true
      elif ! git merge-base --is-ancestor "$live" "$source_commit"; then
        printf 'Cannot order %s against the live source %s on %s.\n' "$source_commit" "$live" "$branch" >&2
        exit 1
      fi
    fi
    parents=(-p "$parent")
  elif [[ $branch == dist ]] && git show-ref --verify --quiet refs/remotes/origin/build; then
    # Start the canonical Pages branch with the existing published history.
    parents=(-p "$(git rev-parse refs/remotes/origin/build)")
  fi
  commit=$(printf '%s\n\nSource: %s\n' "$message" "$source_commit" | publication_commit "$tree" ${parents[@]+"${parents[@]}"})
  if [[ $late_source == true ]]; then
    commit=$(printf '%s\n\nArchived-Source: %s\nLive-Source: %s\n' "$message" "$source_commit" "$live" | publication_commit "$(git rev-parse "$parent^{tree}")" -p "$parent" -p "$commit")
  fi
  refs+=("$commit:refs/heads/$branch")
done
if ((${#refs[@]})); then git push --atomic origin "${refs[@]}"; fi
