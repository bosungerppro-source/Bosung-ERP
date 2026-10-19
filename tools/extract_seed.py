#!/usr/bin/env python3
"""Extract master + transaction data from the factory's Excel files into seed/seed.json.
Usage: python3 extract_seed.py <input_dir> <out_json>
Input files are matched by keyword in file name (see FILES)."""
import sys, os, json, glob, datetime, re, warnings, collections
import openpyxl
warnings.filterwarnings('ignore')
IN = sys.argv[1] if len(sys.argv) > 1 else 'in'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'seed/seed.json'
CUT = datetime.datetime(2026, 1, 1)   # keep detailed history from this date

def find(key):
    for f in glob.glob(os.path.join(IN, '*.xlsx')):
        if key in os.path.basename(f): return f
    raise SystemExit('missing file with key ' + key)

def clean(v):
    if v is None: return None
    if isinstance(v, str):
        v = v.strip()
        if v == '' or v.startswith('#'): return None
        return v
    if isinstance(v, bool): return v
    if isinstance(v, (int, float)):
        if isinstance(v, float):
            if v != v: return None
            v = round(v, 4)
            if v == int(v) and abs(v) < 1e15: return int(v)
        return v
    if isinstance(v, datetime.datetime): return v.strftime('%Y-%m-%d')
    if isinstance(v, datetime.date): return v.strftime('%Y-%m-%d')
    if isinstance(v, datetime.time): return v.strftime('%H:%M')
    return str(v)

def num(v):
    v = clean(v)
    if isinstance(v, (int, float)): return v
    if isinstance(v, str):
        try: return float(v.replace(',', ''))
        except: return None
    return None

def rows(ws, start=1, maxn=None, width=30):
    n = 0
    for r in ws.iter_rows(min_row=start, values_only=True):
        yield [clean(c) for c in r[:width]]
        n += 1
        if maxn and n >= maxn: break

def load(path):
    return openpyxl.load_workbook(path, read_only=True, data_only=True)

DB = collections.OrderedDict()
def put(name, lst): DB[name] = lst; print(name, len(lst))

# ---------------- raw-material warehouse -----------------
wb = load(find('KHO_NVL'))
# customers / partners
cust = []
for r in rows(wb['DMDV'], 2, width=7):
    if r[1] and r[2] and r[0] not in ('01', 'STT'):
        cust.append({'code': r[1], 'name': r[2], 'address': r[3], 'phone': r[4], 'note': r[5]})
# first row (DNV)
first = [{'code': 'DNV', 'name': 'CTY CỔ PHẦN BAO BÌ ĐÔNG NAM VIỆT', 'address': None, 'phone': None, 'note': None}]
seen = set(); out = []
for c in first + cust:
    if c['code'] in seen: continue
    seen.add(c['code']); out.append(c)
put('partners', out)

# opening stock from 'Tổng hợp'
opening = {}
for r in rows(wb['Tổng hợp'], 10, width=16):
    if r[2] and isinstance(r[7], (int, float)) or (r[2] and isinstance(r[8], (int, float))):
        opening[r[2]] = (num(r[7]) or 0, num(r[8]) or 0)

# order sheet (Korea purchase) -> safety stock etc.
order = {}
for r in rows(wb['Oder Korea'], 6, width=16):
    if r[2] and r[3] and str(r[2]).startswith(('R-', 'M')) or (r[2] and r[3]):
        order[r[2]] = r

mats = []; seen = {}
for r in rows(wb['DMNVL.'], 4, width=20):
    code = r[0]
    if not code or not r[2]: continue
    code = str(code)
    if code in seen: continue
    seen[code] = 1
    o = order.get(code)
    op = opening.get(code, (0, 0))
    mats.append({
        'code': code, 'acc_code': r[1], 'name_en': r[2], 'name_vn': r[3],
        'name_kr': o[4] if o else None, 'category': o[1] if o else None,
        'kind': r[17], 'grp': r[15], 'unit': (o[6] if o and o[6] else 'kg'),
        'kg_per_ea': num(r[4]) or 0, 'safety_stock': num(o[5]) if o else None,
        'usage_kg_month': num(o[10]) if o else None, 'usage_ea_month': num(o[11]) if o else None,
        'cas_no': r[14], 'open_kg': round(op[0], 4), 'open_ea': round(op[1], 4), 'note': r[13]})
put('materials', mats)

# ledger
led = []
for r in rows(wb['Nhập - xuất'], 11, width=17):
    if not r[0] or not r[5]:
        continue
    doc = str(r[0])
    led.append({'doc_no': doc, 'date': r[2] or r[1], 'type': 'IN' if doc.startswith(('PNK', 'VBS', 'BVB')) and (num(r[11]) or num(r[12])) else ('OUT' if (num(r[13]) or num(r[14])) else 'IN'),
                'partner_code': r[3], 'partner_name': r[4], 'item_code': r[5], 'wh_code': r[6], 'name': r[7], 'content': r[8],
                'kg_per_ea': num(r[9]), 'in_kg': num(r[11]) or 0, 'in_ea': num(r[12]) or 0, 'out_kg': num(r[13]) or 0, 'out_ea': num(r[14]) or 0})
put('inout', led)
ret = []
for r in rows(wb['phiếu hàng trả'], 4, width=5):
    if r[1] and r[2]:
        ret.append({'date': '2026-07-03', 'code': r[1], 'name': r[2], 'qty_text': r[3]})
put('returns', ret)

# ---------------- production workbook -----------------
wb = load(find('qu_n_l__s_n_xu_t'))
ws = wb['PO']
po = []
for r in rows(ws, 2, width=24):
    if not r[0]: continue
    po.append({'date': r[0], 'condition': r[1], 'customer': r[2], 'country': r[3], 'market': r[4], 'po_no': r[5], 'po_no2': r[6],
               'item_no': r[7], 'manila_no': r[8], 'kind': r[9], 'color': r[10], 'rfid': r[11], 'kind2': r[12], 'color2': r[13],
               'pcs': num(r[14]) or 0, 'sets': num(r[15]) or 0, 'cs': num(r[16]) or 0, 'due': r[17], 'rate': num(r[18]),
               'packed': num(r[19]) or 0, 'diff': num(r[20]), 'yn': r[21], 'mark': r[22]})
put('po', po)

prod = []
def add(**k):
    base = dict(date=None, process=None, shift='D', machine=None, machine_no=None, division=None, part=None, code=None, name=None,
                po_no=None, po_qty=None, plan_qty=None, ok_qty=0, ng_qty=0, ok_ea=None, unit='pcs', start=None, end=None, break_min=None,
                work_min=None, workers=None, stop_min=None, stop_reason=None, remark=None, cavity=None, shots=None, ct=None,
                weight_kg=None, raw_material=None, raw_kg=None, source='history')
    base.update(k)
    if base['ok_ea'] is None: base['ok_ea'] = base['ok_qty']
    prod.append(base)
def fixdiv(d):
    if not d: return d
    return {'Dail': 'Dial', 'regullar': 'Regular', 'Regullar': 'Regular'}.get(d, d)
def since(d): return d and d >= '2026-01-01'

for r in rows(wb['Injection'], 2, width=24):
    if not since(r[0]) or not r[1] or not num(r[12]): continue
    add(date=r[0], process='INJ', machine_no=str(r[1]), division=fixdiv(r[2]), part=r[3], work_min=(num(r[4]) or 0) * 60 if num(r[4]) else None,
        cavity=num(r[5]), shots=num(r[11]), ct=num(r[8]), weight_kg=num(r[9]), ok_qty=num(r[12]) or 0, raw_material=r[18], raw_kg=num(r[19]),
        machine=(r[7] and str(r[7])), name=r[3], code=r[3])
for r in rows(wb['Refill'], 2, width=19):
    if not since(r[0]) or not num(r[10]): continue
    add(date=r[0], process='REF', machine_no=r[1] and str(r[1]), code=r[2], name=r[4], division=fixdiv(r[5]), weight_kg=num(r[6]),
        ok_qty=num(r[10]) or 0, remark=r[3] and ('BM:' + str(r[3])))
for r in rows(wb['Assembly'], 3, width=16):
    if not since(r[0]): continue
    q = num(r[9]) if num(r[9]) is not None else num(r[7])
    if not q: continue
    ng = num(r[15])
    if ng is None: ng = sum((num(x) or 0) for x in r[10:15])
    add(date=r[0], process='ASM', machine_no=r[2] and str(r[2]), machine=r[3], code=r[4], name=r[5], division=fixdiv(r[6]), ok_qty=q, ng_qty=ng or 0)
for r in rows(wb['Wrapping'], 2, width=8):
    if not since(r[0]) or not num(r[6]): continue
    add(date=r[0], process='WRP', machine_no=r[1] and str(r[1]), division=fixdiv(r[2]), name=r[3], plan_qty=num(r[4]), ok_qty=num(r[6]) or 0, ng_qty=num(r[7]) or 0)
for r in rows(wb['Packing'], 2, width=13):
    if not since(r[0]) or not (num(r[7]) or num(r[12])): continue
    add(date=r[0], process='PCK', machine_no=r[1] and str(r[1]), po_no=r[2] and str(r[2]), code=r[9], division=fixdiv(r[4]), po_qty=num(r[6]),
        ok_qty=num(r[7]) or 0, ok_ea=num(r[12]) or 0, unit='set', name=(str(r[5]) + 'CL') if r[5] else None, remark=r[8] and ('Qty ' + str(r[8])))
put('hist_rows_only', [])
DB.pop('hist_rows_only')

# BOM and masters
bom = []
for r in rows(wb['BOM data'], 2, width=20):
    if not r[0] or not r[1]: continue
    bom.append({'retail_no': r[0], 'color_code': r[1], 'color_name': r[2], 'division': r[3], 'n_colors': num(r[4]), 'kind': r[5],
                'nose_code': r[8], 'nose_color': r[9], 'refill_code': r[10], 'refill_color': r[11], 'barrel_code': r[12], 'barrel_color': r[13], 'holder': r[14], 'spoon': r[15]})
put('bom', bom)
ib = []
for r in rows(wb['item bom'], 2, width=9):
    if r[2]:
        ib.append({'item': r[2], 'manila': r[3], 'kind': r[4], 'colors': num(r[5]), 'rfid': r[6], 'kind2': r[7], 'cs': num(r[8])})
put('item_bom', ib)
pr = []
for r in rows(wb['DMSP'], 5, width=13):
    if r[1] and r[2]:
        pr.append({'code': r[1], 'color_name': r[2], 'group_code': r[3], 'kind': r[4], 'version': r[5], 'nose_code': r[6], 'refill_code': r[7],
                   'barrel_code': r[8], 'grp': r[9], 'sku': r[10], 'remarks': r[11]})
put('products', pr)

# recipes
ws = wb['components']
it = ws.iter_rows(values_only=True)
hdr = [clean(c) for c in next(it)][:59]
rec = []
for r in it:
    r = [clean(c) for c in r[:59]]
    if not r[0]: continue
    for j in range(5, len(hdr)):
        h = hdr[j]
        if not h or str(h).startswith('열'): continue
        v = num(r[j]) if j < len(r) else None
        if v: rec.append({'code': r[0], 'sku': r[1], 'color': r[2], 'material': h, 'coef': v})
put('recipes', rec)

# ---------------- daily-report files (08-10-2026 samples) -----------------
def first_time(v): return v
def hhmm(v): return v if isinstance(v, str) else None

# packing
wb = load(find('B_O_C_O__G'))
ws = wb.worksheets[0]
rr = list(rows(ws, 1, width=22))
for r in rr[5:]:
    if r[0] and r[1] and r[1] != '0' and r[3] and num(r[9]) is not None:
        add(date='2026-10-08', process='PCK', machine=r[5], machine_no=str(r[6]), code=r[2], name=r[0], po_no=str(r[3]), po_qty=num(r[4]),
            plan_qty=num(r[8]), ok_qty=num(r[9]) or 0, ok_ea=num(r[11]), unit='set', ng_qty=num(r[12]) or 0, start=hhmm(r[13]), end=hhmm(r[14]),
            break_min=num(r[15]), work_min=num(r[16]), workers=num(r[17]), stop_min=num(r[18]), stop_reason=r[19], shift=r[20] or 'D', source='daily-report', remark='retail ' + str(r[1]))
# refill forming
wb = load(find('B_o_c_o__p_l_i_08'))
ws = wb['Báo cáo ép lõi']
for r in list(rows(ws, 1, width=21))[6:]:
    if r[1] and r[4] and num(r[9]) is not None:
        add(date='2026-10-08', process='REF', machine=r[1], machine_no=str(r[2]), name=r[3], code=r[4], plan_qty=num(r[6]), ok_qty=num(r[9]) or 0,
            ng_qty=num(r[11]) or 0, weight_kg=(num(r[7]) or 0) / 1000, start=hhmm(r[12]), end=hhmm(r[13]), break_min=num(r[14]), work_min=num(r[15]),
            workers=num(r[16]), stop_min=num(r[17]), remark=r[18], shift=r[19] or 'D', division=r[1], source='daily-report')
# erp code spec
refspec = []
for r in rows(wb['Sheet2'], 2, width=9):
    if r[2] and r[5]:
        refspec.append({'customer': r[0], 'kind': r[1], 'code': r[2], 'name': r[3], 'class': r[4], 'erp_code': r[5], 'plan_weight_g': num(r[6]), 'g_per_pc': num(r[7]), 'plan_qty': num(r[8])})
put('refill_specs', refspec)
# wrapping
wb = load(find('qu_n_gi'))
ws = wb['Sheet1']
for r in list(rows(ws, 1, width=28))[5:]:
    if r[1] and r[5] and num(r[11]) is not None:
        add(date='2026-08-10', process='WRP', machine=r[1], machine_no=str(r[2]), name=r[4], code=r[5], po_no=r[6], po_qty=num(r[7]), plan_qty=num(r[9]),
            ok_qty=num(r[11]) or 0, ng_qty=num(r[14]) or 0, work_min=num(r[15]), workers=num(r[16]), stop_min=num(r[17]), remark=r[18], shift=r[19] or 'D', source='daily-report')
subm = []
for r in rows(wb['Sheet3'], 1, width=8):
    if r[1] and r[2]:
        subm.append({'code': r[1], 'name': r[2], 'category': r[3], 'customer': r[4], 'type': r[5], 'grp': r[6]})
put('sub_materials', subm)
# assembly + stamping
wb = load(find('B_O_C_O_L_P_R_P'))
def block(ws, process, d, mapfn):
    shift = 'D'
    for r in rows(ws, 1, width=20):
        s = ' '.join(str(x) for x in r if x)
        if 'Night time' in s and not r[1]: pass
        if r[0] and r[1] and r[2] and r[3] and num(r[4]) is not None and not str(r[0]).startswith('0'):
            mapfn(r, d, shift)
d_ass = '2026-10-08'
def m_ass(r, d, sh):
    add(date=d, process='ASM', machine=r[0], machine_no=str(r[1]), code=r[2], name=r[3], ok_qty=num(r[4]) or 0, start=hhmm(r[5]), end=hhmm(r[6]), break_min=num(r[7]),
        work_min=num(r[8]), stop_min=num(r[9]), workers=num(r[10]), ng_qty=num(r[11]) or 0, remark=r[17], shift=sh, division=('Mini' if 'Mini' in str(r[0]) else 'Regular'), source='daily-report')
def m_stp(r, d, sh):
    add(date=d, process='STP', machine=r[0], machine_no=str(r[1]), code=r[2], name=r[3], ok_qty=num(r[4]) or 0, start=hhmm(r[5]), end=hhmm(r[6]), break_min=num(r[7]),
        work_min=num(r[8]), stop_min=num(r[9]), ng_qty=num(r[10]) or 0, workers=num(r[11]), remark=r[12], shift=sh, division='Mini', source='daily-report')
block(wb['BC lắp ráp Ca ngày'], 'ASM', d_ass, m_ass)
block(wb['BC in tem Ca Ngày'], 'STP', d_ass, m_stp)
# semi items
semi = []; seen = set()
for r in rows(wb['Sheet1'], 2, width=7):
    if r[1] and r[1] not in seen:
        seen.add(r[1]); semi.append({'code': r[1], 'name': r[2], 'category': r[3], 'cl1': r[4], 'cl2': r[5], 'cl3': r[6]})
put('semi_items', semi)
# movement slips
wb = load(find('L_P_R_P__P_NH'))
mov = []
for sh, kind in [('Báo cáo chuyển hàng ép nhựa', 'Injection'), ('B.cao chuyển hàng Ép lõi', 'Refill')]:
    for r in list(rows(wb[sh], 1, width=9))[6:]:
        if r[1] and r[2] and (num(r[4]) or num(r[5])):
            mov.append({'date': '2026-10-08', 'slip_type': 'Transfer of Semi-product', 'from_proc': kind, 'item_code': r[1], 'model': r[2], 'kind': r[3],
                        'qty_in': num(r[4]) or 0, 'qty_out': num(r[5]) or 0, 'total': num(r[6]) or 0, 'work_time': r[7], 'remark': r[8]})
put('movements', mov)

# machines
mach = collections.OrderedDict()
for p in prod:
    k = (p['process'], p['machine_no'], p['machine'])
    key = (p['process'], str(p['machine_no']))
    if key not in mach: mach[key] = {'process': p['process'], 'machine_no': str(p['machine_no']), 'name': p['machine'] or '', 'division': p['division'], 'active': True, 'note': None}
    elif not mach[key]['name'] and p['machine']: mach[key]['name'] = p['machine']
put('machines', list(mach.values()))

# order prod rows & ids
prod.sort(key=lambda x: (x['date'] or '', x['process'] or ''))
for i, p in enumerate(prod, 1): p['id'] = 'L%06d' % i
put('prod_log', prod)

os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
json.dump(DB, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('written', OUT, os.path.getsize(OUT) // 1024, 'KB')
