'use client';

import {useMemo} from 'react';
import {Badge,Card,Flex,Text} from '@radix-ui/themes';
import {Bar,BarChart,CartesianGrid,Cell,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {BlankSlate} from '@/components/WorkspaceUI';

const stages=[
 {id:'saved',label:'Saved',color:'#A18AD9'},
 {id:'applied',label:'Applied',color:'#7052D7'},
 {id:'interviewing',label:'Interviewing',color:'#F49B6F'},
 {id:'offer',label:'Offer',color:'#369C77'},
 {id:'rejected',label:'Rejected',color:'#CF6573'},
 {id:'withdrawn',label:'Withdrawn',color:'#8B8896'}
] as const;

export function ApplicationStageChart({statuses}:{statuses:string[]}){
 const data=useMemo(()=>stages.map(stage=>({...stage,count:statuses.filter(s=>s===stage.id).length})),[statuses]);
 const total=statuses.length;
 return <Card className="analytics-card" variant="surface">
   <div className="analytics-heading">
    <div><span className="page-context">APPLICATION ANALYTICS</span><h2>Where your applications stand</h2><Text as="p" size="2" color="gray">Current stage counts from recorded applications, not historical conversion rates.</Text></div>
    <Badge variant="soft" color="violet" size="2">{total} tracked</Badge>
   </div>
   {!total?<BlankSlate title="Your stage breakdown will appear here" description="Record an application to see its current stage in the chart."/>:
   <>
    <div className="analytics-chart" role="img" aria-label={'Applications by current stage: '+data.map(d=>d.label+' '+d.count).join(', ')}>
      <ResponsiveContainer width="100%" height={245}>
        <BarChart data={data} layout="vertical" margin={{top:4,right:20,bottom:4,left:3}}>
          <CartesianGrid stroke="#EEE7F7" horizontal={false}/>
          <XAxis type="number" allowDecimals={false} tick={{fontSize:11,fill:'#635B78'}}/>
          <YAxis type="category" dataKey="label" tick={{fontSize:12,fill:'#514766'}} width={88} axisLine={false} tickLine={false}/>
          <Tooltip cursor={{fill:'#F4F0FB'}} formatter={(v)=>[v,'Applications']}/>
          <Bar dataKey="count" name="Applications" radius={[0,6,6,0]} maxBarSize={19}>
            {data.map(d=><Cell key={d.id} fill={d.color}/>)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <ul className="chart-key-list" aria-label="Application stage counts">
      {data.filter(d=>d.count>0).map(d=><li key={d.id}><span className="chart-key-swatch" style={{background:d.color}} aria-hidden="true"/><span>{d.label}</span><strong>{d.count}</strong></li>)}
    </ul>
   </>}
 </Card>;
}

export function WorkflowStateChart({states}:{states:Record<string,number>}){
 const entries=Object.entries(states).filter(([,count])=>typeof count==='number'&&Number.isFinite(count)&&count>=0);
 const data=entries.map(([id,count])=>({id,label:id.replace(/_/g,' '),count}));
 const total=data.reduce((sum,v)=>sum+v.count,0);
 return <Card variant="surface" className="analytics-card">
  <div className="analytics-heading"><div><span className="page-context">LIVE QUEUE</span><h2>Workflow states</h2><Text as="p" color="gray" size="2">Actual task counts from the operations API.</Text></div><Badge color="violet" variant="soft">{total} tasks</Badge></div>
  {!entries.length?<BlankSlate title="No workflow tasks" description="Nothing has entered the task queue yet."/>:
  <>
   <div className="workflow-bars" role="img" aria-label={data.map(x=>x.label+': '+x.count).join(', ')}>
    {data.map(x=><div className="workflow-bar-row" key={x.id}><div className="workflow-bar-label"><span>{x.label}</span><strong>{x.count}</strong></div>
     <div className="workflow-bar-track"><div className="workflow-bar-fill" style={{width:total?((x.count/total)*100)+'%':'0%'}}/></div></div>)}
   </div>
   <Text as="p" size="1" color="gray">Bar lengths show each state's share of the current queue. Numbers are exact counts.</Text>
  </>}
 </Card>;
}
