import Vue from 'vue';
import VueRouter from 'vue-router';
import Home from '../views/Home.vue';
import WorkspacePicker from '../views/WorkspacePicker.vue';
import Workspace from '../views/Workspace.vue';
import ImportCache from '../views/ImportCache.vue';

Vue.use(VueRouter);

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/WorkSpacePicker',
    name: 'WorkspacePicker',
    component: WorkspacePicker
  },
  {
    path: '/WorkSpace',
    name: 'Workspace',
    component: Workspace
  },
  {
    path: '/ImportCache',
    name: 'ImportCache',
    component: ImportCache
  }
];

const router = new VueRouter({
  routes
});

export default router;
