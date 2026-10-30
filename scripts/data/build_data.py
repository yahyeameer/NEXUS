# Builds data/terrain/<SITE>, data/evidence-packs/<SITE>.json and media crops from two real LROC PDS products.
# Run: python3 build_data.py <repo>/data
import sys, os, json, math
import numpy as np
from PIL import Image
OUT=sys.argv[1]
R=1737400.0; SCALE=2.0000000000006; LPO=402331.5; SPO=2405168.5; CLAT=26.0
LINES, SAMPLES = 14311, 2555
def load(p):
    a=np.fromfile(p,dtype='<f4',offset=10220,count=LINES*SAMPLES).reshape(LINES,SAMPLES).astype('f8')
    a[(a<-1e30)|(a>1e30)]=np.nan
    return a
dem=load('dem/A15.IMG'); ortho=load('dem/ORTHO.IMG')
def line_of(lat): return LPO - math.radians(lat)*R/SCALE + 1
def sample_of(lon): return SPO + 1 + math.radians(lon-180)*R*math.cos(math.radians(CLAT))/SCALE
def latlon(line,sample):
    lat=math.degrees((LPO-(line-1))*SCALE/R)
    lon=180+math.degrees((sample-1-SPO)*SCALE/(R*math.cos(math.radians(CLAT))))
    return lat, lon-360
STEP=2; NODATA=-32768.0
CRS="Moon sphere R=1737.4 km, planetocentric, equirectangular (center lat 26 N, center lon 180), from NAC_DTM_APOLLO15_E261N0036 label"
DTM_URL="https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO15/NAC_DTM_APOLLO15_E261N0036.IMG"
ORTHO_URL="https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO15/NAC_DTM_APOLLO15_M111578606_2M.IMG"
README_URL="https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO15/NAC_DTM_APOLLO15_README.TXT"
LROC_CREDIT="NASA/GSFC/Arizona State University"
LROC_LICENSE="Public domain: LROC data product from the PDS archive (LROC Terms of Use, https://lroc.im-ldi.com/about/terms)"
USGS_LICENSE="Public domain: U.S. Government work (USGS Gazetteer of Planetary Nomenclature)"
NASA_LICENSE="NASA web content; quoted under NASA media usage guidelines"

def tile(site, l0, s0, size_px):
    sub=dem[l0:l0+size_px+1:STEP, s0:s0+size_px+1:STEP]
    h,w=sub.shape
    d=os.path.join(OUT,'terrain',site); os.makedirs(d,exist_ok=True)
    np.where(np.isnan(sub),NODATA,sub).astype('<f4').tofile(os.path.join(d,'dem.bin'))
    json.dump({"siteId":site,"width":int(w),"height":int(h),"cellSizeM":2.0*STEP,"noData":NODATA,
               "coordinateReferenceSystem":CRS,"sourceEvidenceId":f"EV-{site}-001"},open(os.path.join(d,'dem.json'),'w'),indent=2)
    # Texture: the 2 m orthophoto on the same grid, stretched to 8 bit (≤ 2048², AGENTS.md §6).
    o=ortho[l0:l0+size_px, s0:s0+size_px]
    lo,hi=np.nanpercentile(o,1),np.nanpercentile(o,99)
    img=np.clip((np.nan_to_num(o,nan=lo)-lo)/(hi-lo)*255,0,255).astype('u1')
    Image.fromarray(img).save(os.path.join(d,'texture.png'),optimize=True)
    # Small crop for the evidence_image tool.
    md=os.path.join(OUT,'evidence-packs','media'); os.makedirs(md,exist_ok=True)
    Image.fromarray(img).resize((512,512)).save(os.path.join(md,f'EV-{site}-002.png'),optimize=True)
    n,w_=latlon(l0,s0+1); s_,e=latlon(l0+size_px,s0+size_px+1)
    return l0,s0,[round(w_,5),round(s_,5),round(e,5),round(n,5)]
def xz(l0,s0,line,sample): return {"x":round((sample-s0)*2.0,1),"z":round((line-l0)*2.0,1)}

def dtm_items(site, bbox, feature):
    region={"featureId":feature,"bbox":bbox,"crs":"planetocentric longitude/latitude, degrees (west, south, east, north)"}
    return [
      {"id":f"EV-{site}-001","siteId":site,"type":"dataset","title":"LROC NAC digital terrain model, Apollo 15 landing site (2 m/post)",
       "spokenLabel":"the LROC terrain model","dataset":"LRO LROC NAC DTM","productId":"NAC_DTM_APOLLO15_E261N0036",
       "sourceUrl":DTM_URL,"acquiredAt":"2009-10-30","region":region,"credit":LROC_CREDIT,"license":LROC_LICENSE},
      {"id":f"EV-{site}-002","siteId":site,"type":"image","title":"LROC NAC orthophoto M111578606, Apollo 15 landing site (2 m/pixel)",
       "spokenLabel":"the LROC orthophoto","dataset":"LRO LROC NAC orthophoto","productId":"NAC_DTM_APOLLO15_M111578606_2M",
       "sourceUrl":ORTHO_URL,"acquiredAt":"2009-10-30T21:48:58Z","region":region,"credit":LROC_CREDIT,"license":LROC_LICENSE},
      {"id":f"EV-{site}-003","siteId":site,"type":"text","title":"LROC NAC DTM README: accuracy of the Apollo 15 terrain model",
       "spokenLabel":"the terrain model notes","dataset":"LRO LROC NAC DTM","productId":"NAC_DTM_APOLLO15_E261N0036",
       "sourceUrl":README_URL,
       "excerpt":"Products are tied to LOLA elevations with RMS error of 1.74 m to 7.0 different LOLA orbit tracks.",
       "credit":LROC_CREDIT,"license":LROC_LICENSE},
    ]
TRAVERSE={"sourceUrl":"https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1971-063C","title":"NSSDCA: Apollo 15 Lunar Module record, first EVA traverse",
          "spokenLabel":"the Apollo 15 mission record",
          "excerpt":"The traverse on the first EVA covered 10.3 km to the edge of Hadley Rille to Elbow Crater and near St. George Crater and back to the LM, where a core sample was taken from three meters below the surface.",
          "credit":"NASA Space Science Data Coordinated Archive","license":NASA_LICENSE}

packs={}
# HADLEY_RILLE: the reach upstream of the bend, 26.12 N to 26.07 N.
l0,s0,bbox=tile('HADLEY_RILLE',6050,360,1400)
path=[]
for lat in [26.12,26.11,26.10,26.09,26.08,26.07]:
    l=round(line_of(lat)); m=int(np.nanargmin(dem[l])); path.append(xz(l0,s0,l,m))
dx=path[-1]['x']-path[0]['x']; dz=path[-1]['z']-path[0]['z']; n=math.hypot(dx,dz); px,pz=dz/n,-dx/n
# Sections are perpendicular to the reach. The DTM strip ends ~0.8 km west of the trough, so they run
# 750 m west and 1200 m east (the east mare keeps rising gently for ~1 km before it flattens).
xs=[[{"x":round(p['x']-px*750,1),"z":round(p['z']-pz*750,1)},{"x":round(p['x']+px*1200,1),"z":round(p['z']+pz*1200,1)}] for p in path[2:5]]
feat={"id":"HADLEY_RILLE","siteId":"HADLEY_RILLE","kind":"rille","label":"Rima Hadley (Hadley Rille)","spokenLabel":"Hadley Rille",
      "aliases":["the rille","rille","the channel","rima hadley"],"path":path,"crossSections":xs}
json.dump({"siteId":"HADLEY_RILLE","features":[feat]},open(os.path.join(OUT,'terrain','HADLEY_RILLE','features.json'),'w'),indent=2)
packs['HADLEY_RILLE']=dtm_items('HADLEY_RILLE',bbox,'HADLEY_RILLE')+[
  {"id":"EV-HADLEY_RILLE-004","siteId":"HADLEY_RILLE","type":"text","title":"USGS Gazetteer of Planetary Nomenclature: Rima Hadley (length 116.09 km, centre 25.72 N 3.15 E)",
   "spokenLabel":"the planetary names gazetteer","sourceUrl":"https://planetarynames.wr.usgs.gov/Feature/5064",
   "excerpt":"Named from nearby Mountain (Mons Hadley).",
   "region":{"featureId":"HADLEY_RILLE"},"credit":"USGS Astrogeology Science Center / IAU WGPSN","license":USGS_LICENSE},
  {"id":"EV-HADLEY_RILLE-005","siteId":"HADLEY_RILLE","type":"text",**TRAVERSE},
  {"id":"EV-HADLEY_RILLE-006","siteId":"HADLEY_RILLE","type":"text","title":"NSSDCA: Apollo 15 mission summary, landing site",
   "spokenLabel":"the Apollo 15 mission summary","sourceUrl":"https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo15info.html",
   "excerpt":"Landing Site: Hadley Rille/Apennines (26.13 N, 3.63 E)","credit":"NASA Space Science Data Coordinated Archive","license":NASA_LICENSE},
]
# ELBOW_CRATER: gazetteer centre 26.03 N 3.60 E, diameter 0.34 km.
cl,cs=line_of(26.03),sample_of(3.60)
l0,s0,bbox=tile('ELBOW_CRATER',round(cl)-500,round(cs)-500,1000)
feat={"id":"ELBOW_CRATER","siteId":"ELBOW_CRATER","kind":"crater","label":"Elbow","spokenLabel":"Elbow crater",
      "aliases":["elbow","the crater","crater"],"center":xz(l0,s0,cl,cs),"rimRadiusM":170}
json.dump({"siteId":"ELBOW_CRATER","features":[feat]},open(os.path.join(OUT,'terrain','ELBOW_CRATER','features.json'),'w'),indent=2)
packs['ELBOW_CRATER']=dtm_items('ELBOW_CRATER',bbox,'ELBOW_CRATER')+[
  {"id":"EV-ELBOW_CRATER-004","siteId":"ELBOW_CRATER","type":"text","title":"USGS Gazetteer of Planetary Nomenclature: Elbow (diameter 0.34 km, centre 26.03 N 3.60 E)",
   "spokenLabel":"the planetary names gazetteer","sourceUrl":"https://planetarynames.wr.usgs.gov/Feature/1759",
   "excerpt":"Astronaut-named feature, Apollo 15 site.",
   "region":{"featureId":"ELBOW_CRATER"},"credit":"USGS Astrogeology Science Center / IAU WGPSN","license":USGS_LICENSE},
  {"id":"EV-ELBOW_CRATER-005","siteId":"ELBOW_CRATER","type":"text",**TRAVERSE},
]
# HADLEY_DELTA: north-west flank of Mons Hadley Delta inside the DTM footprint.
cl,cs=line_of(25.75),sample_of(3.62)
l0,s0,bbox=tile('HADLEY_DELTA',round(cl)-750,round(cs)-750,1500)
feat={"id":"HADLEY_DELTA_SLOPE","siteId":"HADLEY_DELTA","kind":"slope","label":"Mons Hadley Delta, north-west flank",
      "spokenLabel":"the Hadley Delta slope","aliases":["the slope","hadley delta","the mountain","delta"],"center":xz(l0,s0,cl,cs),"radiusM":500}
json.dump({"siteId":"HADLEY_DELTA","features":[feat]},open(os.path.join(OUT,'terrain','HADLEY_DELTA','features.json'),'w'),indent=2)
packs['HADLEY_DELTA']=dtm_items('HADLEY_DELTA',bbox,'HADLEY_DELTA_SLOPE')+[
  {"id":"EV-HADLEY_DELTA-004","siteId":"HADLEY_DELTA","type":"text","title":"USGS Gazetteer of Planetary Nomenclature: Mons Hadley Delta (diameter 17.24 km, centre 25.72 N 3.71 E)",
   "spokenLabel":"the planetary names gazetteer","sourceUrl":"https://planetarynames.wr.usgs.gov/Feature/3984",
   "excerpt":"Named from nearby mountain (Mons Hadley).",
   "region":{"featureId":"HADLEY_DELTA_SLOPE"},"credit":"USGS Astrogeology Science Center / IAU WGPSN","license":USGS_LICENSE},
  {"id":"EV-HADLEY_DELTA-005","siteId":"HADLEY_DELTA","type":"text","title":"NASA Apollo 15 mission page: photo caption, Hadley Delta",
   "spokenLabel":"the NASA Apollo 15 photo caption","sourceUrl":"https://www.nasa.gov/mission/apollo-15/",
   "excerpt":"Hadley Delta in the background rises approximately 4,000 meters (about 13,124 feet) above the plain. The base of the mountain is approximately 5 kilometers (about three statue miles) away.",
   "credit":"NASA","license":NASA_LICENSE},
]
for site,items in packs.items():
    json.dump({"siteId":site,"version":1,"items":items},open(os.path.join(OUT,'evidence-packs',f'{site}.json'),'w'),indent=2)
    print(site,len(items),'items')
