"""Conservative rule-first pre-screen. This is not a final, sourced assessment."""
from dataclasses import dataclass
from typing import Literal
import re


@dataclass(frozen=True)
class PreliminaryAssessment:
    status: Literal['verified_eligible', 'likely_eligible', 'unknown', 'ineligible']
    reason: str


def assess_text(text: str, country: str = 'Nigeria') -> PreliminaryAssessment:
    s = re.sub(r'\s+', ' ', text).lower()
    # Explicit residence/authorization constraints override all other text.
    restricted = [r'\b(?:remote\s+)?(?:us|usa|u\.s\.)\s+only\b',
                  r'\bus residents only\b', r'\bmust reside in (?:the )?united states\b',
                  r'\b(?:must|required to) (?:already )?have (?:us|u\.s\.) work authorization\b',
                  r'\b(?:only|exclusively) (?:hire|hiring) (?:in|from) (?:the )?united states\b']
    if country.lower() != 'united states' and any(re.search(p, s) for p in restricted):
        return PreliminaryAssessment('ineligible', 'Explicit US location or authorization restriction')
    if re.search(r'\b(?:worldwide|globally|anywhere in the world)\b', s):
        if country.lower() in s and 'remote' in s:
            return PreliminaryAssessment('verified_eligible', 'Explicit worldwide remote availability includes location; must attach actual source evidence')
        return PreliminaryAssessment('likely_eligible', 'Worldwide remote advertised; local hiring arrangements not explicitly verified')
    return PreliminaryAssessment('unknown', 'Insufficient explicit location eligibility evidence')
