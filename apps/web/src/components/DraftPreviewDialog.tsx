'use client';

import {Button,Dialog,Flex,Text,Badge} from '@radix-ui/themes';

export function DraftPreviewDialog({subject,body,status}:{subject:string;body:string;status:string}){
 return <Dialog.Root>
   <Dialog.Trigger><Button type="button" size="2" color="violet" variant="soft">Read full draft</Button></Dialog.Trigger>
   <Dialog.Content maxWidth="660px" className="draft-preview-dialog">
     <Flex align="start" justify="between" gap="3">
       <div><Text size="1" weight="bold" className="page-context">PRIVATE OUTREACH DRAFT</Text><Dialog.Title mb="1">Message preview</Dialog.Title></div>
       <Dialog.Close><Button type="button" color="gray" variant="soft">Close</Button></Dialog.Close>
     </Flex>
     <div className="draft-preview-meta"><Text size="2" weight="bold">Subject</Text><Text size="2">{subject}</Text><Badge color="violet" variant="soft">{status.replace(/_/g,' ')}</Badge></div>
     <div className="draft-preview-body"><Text size="2">{body}</Text></div>
     <Text size="1" color="gray">This preview is read-only. Career Intelligence has not sent the email.</Text>
   </Dialog.Content>
 </Dialog.Root>;
}
