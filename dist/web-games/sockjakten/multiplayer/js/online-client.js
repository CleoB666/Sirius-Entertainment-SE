/** TTHC dedicated multiplayer client. This module NEVER simulates a match. */
export function createOnlineClient({onEvent,onChange}) {
  const state={role:'local',connected:false,phase:'waiting',room:'',slot:0,token:'',server:'',name:'',character:'clawster',
    roster:[],lobby:{bots:0,difficulty:'normal',stage:'select',levelIndex:0},message:'',socket:null,manualClose:false,reconnectAttempts:0,pendingActions:[],
    lastSnapshotAt:0,reconnectTimer:null};
  const publish=()=>onChange(state);
  function send(message){if(state.socket?.readyState!==WebSocket.OPEN)return false;try{state.socket.send(JSON.stringify(message));return true;}catch{return false;}}
  function disconnect(){
    state.manualClose=true;clearTimeout(state.reconnectTimer);
    if(state.socket?.readyState===WebSocket.OPEN)send({type:'leave'});
    state.socket?.close();state.socket=null;state.role='local';state.connected=false;state.phase='waiting';
    state.room='';state.roster=[];state.pendingActions.length=0;state.message='';publish();
  }
  function connect(role,rawServer,room='',character='clawster',retry=false,name=''){
    const server=String(rawServer||'').trim();
    if(!/^wss?:\/\//.test(server)){state.message='Enter a valid WebSocket server URL (ws:// or wss://).';publish();return false;}
    if(location.protocol==='https:'&&server.startsWith('ws://')){state.message='Secure pages require wss:// for online play.';publish();return false;}
    if(!retry){state.role=role;state.room=room.toUpperCase().trim();state.name=name||'';state.character=character;state.token=role==='guest'?(sessionStorage.getItem('tthc-room-token-'+state.room)||''):'';state.reconnectAttempts=0;}
    state.server=server;state.manualClose=false;state.message=retry?'Reconnecting to dedicated match server…':'Connecting to dedicated match server…';
    const previous=state.socket;state.socket=null;previous?.close();
    const ws=new WebSocket(server);state.socket=ws;
    ws.addEventListener('open',()=>{if(ws!==state.socket)return;
      send(state.room && state.token?{type:'join',room:state.room,token:state.token,character:state.character,name:state.name}:
        role==='host'?{type:'host',name:state.name,character:state.character}:
        {type:'join',room:state.room,character:state.character,name:state.name});
    });
    ws.addEventListener('message',event=>{
      if(ws!==state.socket)return;let p;try{p=JSON.parse(event.data);}catch{return;}
      if(!p||typeof p!=='object')return;
      if(p.type==='welcome'){
        state.connected=true;state.role=p.role;state.room=p.room;state.slot=p.slot;state.token=p.token||'';
        state.phase=p.phase||'waiting';state.reconnectAttempts=0;state.message='';
        if(state.token)sessionStorage.setItem('tthc-room-token-'+state.room,state.token);
      }else if(p.type==='role'){
        state.role=p.role;state.message='You are now the room leader. The server continues running the match.';
      }else if(p.type==='roster'){
        state.roster=Array.isArray(p.players)?p.players:[];state.phase=p.phase||'waiting';
        if(p.lobby&&typeof p.lobby==='object')state.lobby={...state.lobby,...p.lobby};
        const me=state.roster.find(x=>x.slot===state.slot);
        if(me&&me.leader)state.role='host';else if(me)state.role='guest';
      }else if(p.type==='start')state.phase='playing';
      else if(p.type==='finish')state.phase='finished';
      else if(p.type==='closed'||p.type==='error'){
        state.message=String(p.message||'Server unavailable.');
        if(p.type==='closed'){state.manualClose=true;state.connected=false;state.role='local';}
      }else if(p.type==='snapshot')state.lastSnapshotAt=performance.now();
      onEvent(p,state);publish();
    });
    ws.addEventListener('error',()=>{if(ws===state.socket){state.message='Could not reach the server. Check the address or deployment.';publish();}});
    ws.addEventListener('close',()=>{
      if(ws!==state.socket)return;state.socket=null;state.connected=false;state.pendingActions.length=0;
      if(!state.manualClose && state.room && state.token && state.reconnectAttempts<9){
        const delay=Math.min(10000,800*1.6**state.reconnectAttempts++);
        state.message='Connection interrupted. Your place is reserved; reconnecting…';publish();
        state.reconnectTimer=setTimeout(()=>{if(!state.manualClose&&!state.connected)connect(state.role,state.server,state.room,state.character,true,state.name);},delay);
      }else {state.message='Connection lost. Return to the lobby to try again.';publish();}
    });publish();return true;
  }
  function queueAction(action){if(['hide','ability','use','stash'].includes(action)&&state.pendingActions.length<8)state.pendingActions.push(action);}
  function sendInput(controls){
    if(!state.connected||!['guest','host'].includes(state.role)||state.phase!=='playing')return;
    const actions=state.pendingActions.splice(0,4);
    send({type:'input',controls,actions});
  }
  return Object.assign(state,{send,disconnect,connect,queueAction,sendInput});
}
