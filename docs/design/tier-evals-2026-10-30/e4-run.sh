#!/bin/zsh
# usage: run.sh <tag> <script> <ids comma list> <extra args...>
B=/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/bakeoff
S=$OUT
tag=$1; script=$2; ids=",$3,"; shift 3
mkdir -p $S/$tag
while IFS=$'\t' read -r id cat prompt; do
  [[ "$ids" == *",$id,"* ]] || continue
  [ -f $S/$tag/$id.png ] && continue
  la=$(sysctl -n vm.loadavg | awk '{print $2}'); s=$(date +%s)
  $B/venv/bin/python $B/peak.py $B/venv/bin/$script $S/$tag/$id.json --seed 7 --width 1024 --height 1024 --prompt "$prompt" --output $S/$tag/$id.png "$@" > $S/$tag/$id.log 2>&1
  e=$(date +%s); echo "$tag $id $cat wall=$((e-s))s load=$la $(cat $S/$tag/$id.json 2>/dev/null)" >> $S/img/results.txt
done < $B/prompts.tsv
echo "FINISHED $tag" >> $S/img/results.txt
