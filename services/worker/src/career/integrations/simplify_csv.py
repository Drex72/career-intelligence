"""Portable application CSV exchange, not an undocumented Simplify API."""
import csv
import io
from urllib.parse import urlsplit

COLUMNS=['Company','Job Title','Job URL','Status']
VALID={'discovered','saved','applied','interviewing','offer','rejected','withdrawn'}

def read_application_csv(content:str)->list[dict]:
    output=[]
    for row in csv.DictReader(io.StringIO(content)):
        url=(row.get('Job URL') or '').strip()
        p=urlsplit(url)
        if p.scheme not in ('http','https') or not p.netloc:continue
        status=(row.get('Status') or 'saved').strip().lower()
        if status not in VALID:continue
        output.append({'company':(row.get('Company') or '').strip(), 'title':(row.get('Job Title') or '').strip(),'url':url,'status':status})
    return output


def export_application_csv(items:list[dict])->str:
    output=io.StringIO();writer=csv.DictWriter(output,fieldnames=COLUMNS,extrasaction='ignore');writer.writeheader();writer.writerows(items)
    return output.getvalue()
