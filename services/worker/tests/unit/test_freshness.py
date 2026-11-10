from datetime import datetime,timedelta,timezone
from career.discovery.freshness import classify_freshness
NOW = datetime(2026,11,10,tzinfo=timezone.utc)

def test_recent_job_is_primary():
    assert classify_freshness(NOW-timedelta(hours=24), None, NOW, NOW).label == 'primary'

def test_updated_old_job_not_fresh():
    assert classify_freshness(NOW-timedelta(days=40), NOW, NOW, NOW).label == 'old'

def test_seven_day_fallback():
    assert classify_freshness(NOW-timedelta(days=5), None, NOW, NOW).label == 'expanded'

def test_missing_publish_time_unknown():
    assert classify_freshness(None, NOW, NOW, NOW).label == 'unknown'
