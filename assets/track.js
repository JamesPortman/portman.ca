// First-party visit counting, loaded by every public page. No cookies: the
// server counts visitors by a daily-rotating hash and never stores an IP.
// Google Analytics is separate and still waits for the consent banner.
//
// Sends one pageview per load, plus these visitor actions:
//   painting_click   a painting or photograph on georgianartist.com (target: products/<slug>)
//   app_open         one of the apps served here (target: terra-incognita, no-exit, …)
//   screenshot_open  a project screenshot opened full size (target: file name)
//   section_open     the Apps / Media / Paintings tabs (target: apps, media, paintings)
//   outbound_click   any other link off the site (target: host name)
//   email_click      a mailto: link
// /api/track validates every field and drops anything it doesn't recognise.
(function(){
  try{
    if(location.pathname.indexOf('/admin')===0)return;
    // "Don't count this browser" on the admin dashboard sets this flag.
    try{ if(localStorage.getItem('pc_no_track')==='1')return; }catch(_){}

    function send(p){
      try{
        var b=JSON.stringify(p);
        if(navigator.sendBeacon){navigator.sendBeacon('/api/track',new Blob([b],{type:'application/json'}));}
        else{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true});}
      }catch(_){}
    }
    function act(action,target){ send({kind:'action',action:action,target:target||'',path:location.pathname}); }

    send({kind:'pageview',path:location.pathname,referrer:document.referrer||''});

    var APPS=['terra-incognita','no-exit','beyond-doubt','worldcup'];
    document.addEventListener('click',function(e){
      var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
      if(!a)return;
      var cat=a.getAttribute('data-cat');
      if(cat){ act('section_open',cat); return; }
      var href=a.getAttribute('href')||'';
      if(href.indexOf('mailto:')===0){ act('email_click'); return; }
      var u; try{ u=new URL(a.href,location.href); }catch(_){ return; }
      if(!/^https?:$/.test(u.protocol))return;
      var host=u.hostname.replace(/^www\./,'');
      if(u.origin===location.origin){
        var first=u.pathname.split('/')[1]||'';
        if(APPS.indexOf(first)>-1){ act('app_open',first); return; }
        if(a.classList.contains('zoom')){ act('screenshot_open',u.pathname.split('/').pop()); }
        return;
      }
      var m=/^\/(products|photographs)\/([a-z0-9-]+)\/?$/.exec(u.pathname);
      if(host==='georgianartist.com'&&m){ act('painting_click',m[1]+'/'+m[2]); return; }
      act('outbound_click',host);
    },true);
  }catch(e){}
})();
