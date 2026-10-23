import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'my-blog-manager'))
from cms_core.briefing_integration import BriefingIntegration
from cms_core.briefing_console import atomic_json, default_config, public_config, BriefingStore


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'tests')
        self.root=Path(self.temp.name)
        self.manager=self.root/'my-blog-manager'
        self.site=self.root/'XHBlogs'
        atomic_json(self.site/'data/dailyBriefing.json',{'edition':{'date':'1970.01.01'},'items':[]})
        atomic_json(self.site/'data/dailyBriefingArchive.json',{'issues':[]})
        atomic_json(self.site/'data/briefingConfig.json',public_config(default_config()))
        self.service=BriefingIntegration(self.manager)
        app=FastAPI()
        @app.get('/api/status')
        def status(): return {'original':True}
        app.mount('/',self.service)
        self.client=TestClient(app,base_url='http://127.0.0.1:19876')
        self.auth={'x-briefing-admin':self.service.token_path.read_text()}
        self.env=patch.dict(os.environ,{'XHS_BRIEFING_SITE_ROOT':str(self.site)})
        self.env.start()
    def tearDown(self):
        self.env.stop(); self.temp.cleanup()
    def test_original_routes_remain_available(self):
        self.assertTrue(self.client.get('/api/status').json()['original'])
    def test_empty_install_and_real_port(self):
        self.assertEqual(self.client.get('/api/briefing/issues',headers=self.auth).json()['issues'],[])
        self.assertEqual(self.client.get('/api/briefing/connection-info',headers=self.auth).json()['baseUrl'],'http://127.0.0.1:19876')
        self.assertEqual(self.client.get('/api/briefing/settings').status_code,401)
    def test_first_read_preserves_existing_public_preferences(self):
        config=default_config(); config['display']['enabled']=True; config['selection']['topics']=['Photography']
        atomic_json(self.site/'data/briefingConfig.json',public_config(config))
        result=self.client.get('/api/briefing/settings',headers=self.auth).json()['config']
        self.assertTrue(result['display']['enabled']); self.assertEqual(result['selection']['topics'],['Photography'])
    def test_switching_sites_keeps_private_settings_separate(self):
        first=self.client.get('/api/briefing/settings',headers=self.auth).json()['config']
        first['selection']['topics']=['Music']
        self.assertEqual(self.client.put('/api/briefing/settings',headers=self.auth,json=first).status_code,200)
        second=self.root/'other-site'
        atomic_json(second/'data/dailyBriefing.json',{'edition':{'date':'1970.01.01'},'items':[]})
        atomic_json(second/'data/dailyBriefingArchive.json',{'issues':[]})
        with patch.dict(os.environ,{'XHS_BRIEFING_SITE_ROOT':str(second)}):
            self.assertEqual(self.client.get('/api/briefing/settings',headers=self.auth).json()['config']['selection']['topics'],[])
        self.assertEqual(self.client.get('/api/briefing/settings',headers=self.auth).json()['config']['selection']['topics'],['Music'])
    def test_missing_website_reports_configuration_problem(self):
        with patch.dict(os.environ,{'XHS_BRIEFING_SITE_ROOT':str(self.root/'missing')}):
            self.assertEqual(self.client.get('/api/briefing/settings',headers=self.auth).status_code,503)
    def test_empty_install_can_publish_its_first_issue(self):
        from datetime import datetime, timedelta, timezone
        date=datetime.now(timezone(timedelta(hours=8))).strftime('%Y.%m.%d')
        issue={'edition':{'date':date,'weekday':'','label':'First','notice':''},'items':[{'id':'first','category':'news','title':'Example','summary':'Checked summary','source':'Example','sourceOrg':'Example','sourceDate':date,'verifiedAt':date,'url':'https://example.com/source','verificationUrls':['https://example.com/source'],'highlights':[],'tags':[],'readingNote':'','originalTitle':'Example','doi':''}]}
        response=self.client.post('/api/briefing/drafts',headers=self.auth,json={'issue':issue})
        self.assertEqual(response.status_code,200,response.text)
        draft=response.json()['draft']
        response=self.client.post('/api/briefing/drafts/'+draft['id']+'/publish',headers=self.auth,json={'revision':draft['revision'],'reviewed':True})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.client.get('/api/briefing/status',headers=self.auth).json()['issueCount'],1)
    def test_updater_protects_user_data_and_updates_client(self):
        spec=importlib.util.spec_from_file_location('updater',ROOT/'update.py'); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        for name in ('XHBlogs/posts/a.md','my-blog-manager/manager_data/briefing/config.json','XHBlogs/siteConfig.ts','my-blog-manager/data/deploy_config.json'):
            self.assertFalse(module.managed_path(name),name)
        for name in ('XHBlogs/data/briefingConfig.json','XHBlogs/public/images/daily-briefing/user.png','my-blog-manager/public/backend_config.json'):
            self.assertTrue(module.preserve_existing(name,True),name)
        self.assertFalse(module.preserve_existing('my-blog-manager/public/briefing_agent.py',True))

if __name__=='__main__': unittest.main(verbosity=2)
