"""Evidence-limited specialist agents. Deterministic fallbacks without LLM.

Optional LangGraph graph is defined in graph.py. No external side effects here.
"""
from __future__ import annotations
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urlparse,urljoin
from typing import Literal
import json
import re


@dataclass(frozen=True)
class Evidence:
    source_url: str
    kind: Literal['posting','official','employer','community']
    text: str
    scope: Literal['job','company']

@dataclass(frozen=True)
class Decision:
    status: Literal['verified_eligible','likely_eligible','unknown','ineligible']
    confidence: float
    reasons: tuple[str,...]
    evidence: tuple[Evidence,...]


def classify_employer_evidence(job_text:str,evidence:list[Evidence])->Decision:
    """Hard restrictions dominate other evidence; positive requires job-scoped authoritative proof."""
    from career.eligibility.rules import assess_text
    combined=[Evidence('about:job','posting',job_text,'job')]+evidence
    for e in combined:
        neg=re.search(r'(?:cannot|can.not|do not|don.t|unable to|will not)\s+(?:hire|employ)\s+(?:from|in)\s+nigeria|(?:applicants\s+)?residing\s+in\s+nigeria\s+(?:are\s+)?not\s+eligible|nigeria\s+is\s+excluded',e.text,re.I)
        if neg and e.kind in ('posting','official','employer') and e.scope=='job':
            return Decision('ineligible',0.99,('Explicit Nigeria hiring restriction',),(e,))
        status=assess_text(e.text)
        if status.status=='ineligible' and e.kind in ('posting','official','employer') and e.scope=='job':
            return Decision('ineligible',0.99,(status.reason,),(e,))
    for e in combined:
        s=e.text.lower()
        if e.kind in ('posting','official','employer') and e.scope=='job' and 'nigeria' in s and ('remote' in s or 'residing' in s or 'employ' in s) and any(p in s for p in ('can employ','may apply','eligible','allowed','residing in nigeria','hire from nigeria')):
            return Decision('verified_eligible',0.9,('Explicit, job-scoped authorized evidence supports hiring from Nigeria',),(e,))
    positives=[e for e in combined if any(x in e.text.lower() for x in ('worldwide','global remote','anywhere in the world','nigeria'))]
    if positives:return Decision('likely_eligible',0.55,('Relevant international hiring language; local eligibility is not verified',),tuple(positives))
    return Decision('unknown',0,('No conclusive Nigeria eligibility evidence',),tuple(evidence))

@dataclass(frozen=True)
class Rank:
    score:int
    matched:tuple[str,...]
    missing:tuple[str,...]

KEYWORDS=('python','typescript','javascript','node.js','backend','infrastructure','distributed','postgresql','supabase','machine learning','ai','research','kubernetes','go','rust')

def score_match(job_text:str,knowledge_text:str)->Rank:
    job=job_text.casefold(); personal=knowledge_text.casefold()
    required=[k for k in KEYWORDS if re.search(r'(?<!\w)'+re.escape(k)+r'(?!\w)',job)]
    matched=[k for k in required if k in personal]
    missing=[k for k in required if k not in personal]
    return Rank(round(100*len(matched)/len(required)) if required else 0,tuple(matched),tuple(missing))


class _JSONLD(HTMLParser):
    def __init__(self):super().__init__();self.active=False;self.raw=[];self.docs=[]
    def handle_starttag(self,tag,attrs):
        self.active=tag=='script' and dict(attrs).get('type','').lower()=='application/ld+json'
        if self.active:self.raw=[]
    def handle_data(self,data):
        if self.active:self.raw.append(data)
    def handle_endtag(self,tag):
        if tag=='script' and self.active:
            try:self.docs.append(json.loads(''.join(self.raw)))
            except (ValueError,TypeError):pass
            self.active=False


def parse_contact_candidates(html:str,base_url:str)->list[dict]:
    parser=_JSONLD();parser.feed(html)
    found=[]
    def walk(value):
        if isinstance(value,list):
            for v in value:yield from walk(v)
        elif isinstance(value,dict):
            if value.get('@type')=='Person' or 'Person' in (value.get('@type') if isinstance(value.get('@type'),list) else []):yield value
            for child in value.values():
                if isinstance(child,(list,dict)):yield from walk(child)
    origin=urlparse(base_url).hostname
    for doc in parser.docs:
        for d in walk(doc):
            name=d.get('name');title=d.get('jobTitle');url=urljoin(base_url,d.get('url') or '')
            if name and title and urlparse(url).hostname==origin:
                found.append({'name':str(name),'title':str(title),'profile_url':url,'source':base_url})
    return found[:20]


def build_outreach(first_name:str,role:str,company:str,experience:str,shared_context:dict|None=None)->dict:
    """Source-backed templating. No inferred personal connections."""
    intro=f'Hi {first_name},\n\nI recently applied for the {role} role at {company}.'
    if shared_context and shared_context.get('verified') and shared_context.get('source_url'):
        intro+=f" I also noticed we share a connection through {shared_context['organization']}."
    body=intro+f'\n\nBy way of background, {experience.strip().rstrip(".")}. I would be interested in your perspective on the team and its engineering challenges.\n\nWould you be open to a short conversation?\n\nBest regards'
    return {'subject':f'Question about {role} at {company}','body':body,'requires_review':True}


def classify_reply(text:str)->str:
    t=text.casefold()
    if any(s in t for s in ('do not contact','unsubscribe','remove me','stop emailing','take me off')):return 'opt_out'
    if any(s in t for s in ('happy to refer','can refer you','i will refer','referral submitted')):return 'referral'
    if any(s in t for s in ('interview','schedule a call','speak with the team')):return 'interview'
    if any(s in t for s in ('not hiring','unfortunately','not interested')):return 'declined'
    return 'other'
