'use client';

import {AlertDialog,Button,Flex} from '@radix-ui/themes';

export function SourceApprovalActions({name,busy,onApprove,onReject}:{
 name:string;busy:boolean;onApprove:()=>void;onReject:()=>void;
}){
 return <Flex align="center" gap="2" wrap="wrap">
   <Button type="button" size="2" variant="soft" color="green" disabled={busy} onClick={onApprove}>Approve source</Button>
   <AlertDialog.Root>
     <AlertDialog.Trigger><Button type="button" size="2" variant="outline" color="red" disabled={busy}>Reject</Button></AlertDialog.Trigger>
     <AlertDialog.Content maxWidth="430px">
       <AlertDialog.Title>Reject this public source?</AlertDialog.Title>
       <AlertDialog.Description size="2">The proposed board for <strong>{name}</strong> will be marked rejected. This does not delete any applications or send messages.</AlertDialog.Description>
       <Flex gap="3" justify="end" mt="4">
         <AlertDialog.Cancel><Button type="button" color="gray" variant="soft">Cancel</Button></AlertDialog.Cancel>
         <AlertDialog.Action><Button type="button" color="red" onClick={onReject}>Reject source</Button></AlertDialog.Action>
       </Flex>
     </AlertDialog.Content>
   </AlertDialog.Root>
 </Flex>;
}
