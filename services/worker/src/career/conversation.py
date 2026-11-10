"""Conversation intelligence without autonomous sending privileges."""
import re
from career.agents import classify_reply


def process_reply(platform,owner:str,sender:str,body:str,*,company_id=None,job_id=None,source_url=None)->str:
    result=classify_reply(body)
    if result=='opt_out': platform.suppress(sender.lower())
    # Store only exact, role-scoped hiring limitations from direct employer communication.
    if company_id and job_id and source_url and re.search(r'(?:this|the)\s+(?:particular\s+|current\s+)?(?:role|position)',body,re.I) and re.search(r'(?:must|requires?)\s+(?:applicants\s+)?(?:to\s+)?reside\s+in\s+the\s+united\s+states',body,re.I):
        platform.save_intelligence(company_id,'Recruiter states this position requires United States residency',source_url,'employer',job_id)
    platform._event('conversation_classified',job_id,{'category':result,'sender_domain':sender.rpartition('@')[-1]})
    return result
