#!/usr/bin/env python3
"""소속 지역본부 검증: 금감원 목록의 지역본부로 조합을 묶어 더한 값이 금융위원회 시도 합계와 같은지 확인.
사용: python3 scripts/verify_hq.py 202112 202606"""
import json,glob,re,collections,sys
comp=json.load(open('docs/data/probe/fisis_company_Q.json'))['list']
hq={}
for c in comp:
    m=re.search(r'농협\((.+?)\)',c['finance_path']); hq[c['finance_cd']]=m.group(1) if m else ''
agg={}
for p in glob.glob('docs/data/coop/03213*S.json'):
    d=json.load(open(p)); agg[re.search(r'\((.+)\)',d['nm']).group(1)]=d
coops={}
for p in glob.glob('docs/data/coop/0010027*.json'):
    d=json.load(open(p)); coops[d['cd']]=d
def val(d,ym,t,c):
    r=[x for x in d['d'].get(ym,{}).get(t,[]) if x[0]==c]; return r[0][1] if r else None
T='재무현황_요약재무상태표(자산)'
for ym in sys.argv[1:]:
    print('==',ym)
    sums=collections.Counter(); cnt=collections.Counter(); nohq=[]
    for cd,d in coops.items():
        v=val(d,ym,T,'A')
        if v is None: continue
        h=hq.get(cd,'')
        if not h: nohq.append(d['nm']); continue
        sums[h]+=v; cnt[h]+=1
    tot=0
    for h,a in sorted(agg.items()):
        av=val(a,ym,T,'A') or 0; s=sums.get(h,0); tot+=abs(s-av)
        print(f"{h}: {cnt[h]}곳 {s/1e8:,.0f}억 / 합계 {av/1e8:,.0f}억 / 차 {(s-av)/1e8:,.1f}억")
    print('본부 없음',nohq,'| 절대차 합',round(tot/1e8,1))
