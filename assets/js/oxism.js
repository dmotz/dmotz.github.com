(function(){var e,t,n,o,r,u,l,a,i,d,c,s,m,f,h,p,g,v,w,y,E,L,B;e=Math.abs,v=Math.sqrt,d="ontouchstart"in window,s=B=a=0,p=[],L={transform:"transform"},w=t=h=null,y=document.createElement("div"),g="/works/",n=function(e){return e[0].toUpperCase()+e.slice(1)},l=function(){var e;return e=document.location.pathname,"/"===e?null:e.split(g)[1].replace("/","")},f=function(){var e;return(e=l())?(s=window.pageYOffset,t&&(t.className=""),t=document.getElementById("content-"+l()),h.scrollTop=0,t.className="active",document.body.className="perma"):(window.scrollTo(0,s),document.body.className="")},i=function(e){return e.addEventListener("click",function(t){return t.preventDefault(),history.pushState(null,null,e.href),f()},!0)},o=function(){var e,t,n,o,r,u,l;for(e=r=0,u=w.length;u>r;e=++r)n=w[e],l=n.getBoundingClientRect(),t=l.left,o=l.top,p[e]=[t,o];return null},u=function(){var e;return e=null,function(){return clearTimeout(e),e=setTimeout(o,333)}}(),r=10,m=function(t){var n,o,u,l,i,d,c,s,m;for(l=s=0,m=w.length;m>s;l=++s)c=w[l],n=t.pageX-p[l][0]-B/2,o=t.pageY-p[l][1]-a/2,u=v(Math.pow(e(n),2)+Math.pow(e(o),2)),d=n/((u||1)/r),i=-o/((u||1)/r),c.children[0].style[L.transform]="rotateX("+i+"deg) rotateY("+d+"deg)";return null};for(c in L)E=L[c],L[c]=function(){var e,t,o,r,u;for(u=["Webkit","Moz","ms"],o=0,r=u.length;r>o;o++)if(t=u[o],(e=t+n(E))in y.style)return e;return E in y.style?E:null}();document.addEventListener("DOMContentLoaded",function(){var e,t,n,r;if(setTimeout(function(){return document.documentElement.className=d?"touch":""},0),w=document.getElementById("grid").children,h=document.getElementById("perma"),B=a=parseInt(window.getComputedStyle(w[0]).width,10),document.getElementById("email").href=["m","a","i","l","t","o",":","d","a","n","@","o","x","i","s","m",".","c","o","m"].join(""),!d){if(document.addEventListener("keydown",function(e){return 27===e.keyCode&&l()?(history.pushState(null,null,"/"),f()):void 0}),!L.transform)return;o(),window.addEventListener("resize",u),document.addEventListener("mousemove",m,!1)}if(window.history.pushState){for(f(),r=document.querySelectorAll("#grid > a"),t=0,n=r.length;n>t;t++)e=r[t],i(e);return i(document.getElementById("x")),addEventListener("popstate",f)}},!1)}).call(this);
//# sourceMappingURL=oxism.js.map